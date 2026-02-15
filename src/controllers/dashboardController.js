import Customer from '../models/Customer.js';
import Supplier from '../models/Supplier.js';
import Mazdoor from '../models/Mazdoor.js';
import Account from '../models/Account.js';
import Sale from '../models/Sale.js';
import { getAccountBalance } from './transactionController.js';
import { getCurrentStockData } from './stockController.js';

/**
 * Dashboard summary: counts, total balance, today's sales, current stock.
 * Query: lowStockThreshold (number) — parts with quantity < this are flagged as low stock.
 */
export const getSummary = async (req, res) => {
  const lowStockThreshold = Number(req.query.lowStockThreshold);
  const useLowStock = !isNaN(lowStockThreshold);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  const [customersCount, suppliersCount, mazdoorCount, accounts, todaySalesResult, stockData] = await Promise.all([
    Customer.countDocuments(),
    Supplier.countDocuments(),
    Mazdoor.countDocuments(),
    Account.find({}).lean(),
    Sale.aggregate([
      { $match: { date: { $gte: todayStart, $lte: todayEnd } } },
      { $group: { _id: null, count: { $sum: 1 }, totalAmount: { $sum: '$amountReceived' } } },
    ]),
    getCurrentStockData(),
  ]);

  let totalBalance = 0;
  for (const a of accounts) {
    const flow = await getAccountBalance(a._id);
    totalBalance += (a.openingBalance ?? 0) + flow;
  }

  const todaySales = todaySalesResult[0] || { count: 0, totalAmount: 0 };
  const stockSummary = stockData.map((row) => ({
    ...row,
    lowStock: useLowStock && row.quantity < lowStockThreshold,
  }));
  const lowStockCount = useLowStock ? stockSummary.filter((s) => s.lowStock).length : undefined;

  res.json({
    success: true,
    data: {
      counts: { customers: customersCount, suppliers: suppliersCount, mazdoor: mazdoorCount },
      totalBalance,
      todaySales: { count: todaySales.count, totalAmount: todaySales.totalAmount },
      stockSummary,
      ...(useLowStock && { lowStockCount }),
    },
  });
};
