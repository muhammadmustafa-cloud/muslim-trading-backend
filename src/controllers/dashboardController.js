import Customer from '../models/Customer.js';
import Supplier from '../models/Supplier.js';
import Mazdoor from '../models/Mazdoor.js';
import Account from '../models/Account.js';
import Sale from '../models/Sale.js';
import StockEntry from '../models/StockEntry.js';
import { getAccountBalance } from './transactionController.js';
import { getCurrentStockData } from './stockController.js';

/**
 * Dashboard summary: counts, total balance, today's sales, current stock, overall profit.
 * Query: lowStockThreshold (number) — items with quantity < this are flagged as low stock.
 */
export const getSummary = async (req, res) => {
  const lowStockThreshold = Number(req.query.lowStockThreshold);
  const useLowStock = !isNaN(lowStockThreshold);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  const [customersCount, suppliersCount, mazdoorCount, accounts, todaySalesResult, stockData, totalPurchaseResult, totalSalesResult, pendingPaymentsResult] = await Promise.all([
    Customer.countDocuments(),
    Supplier.countDocuments(),
    Mazdoor.countDocuments(),
    Account.find({}).lean(),
    Sale.aggregate([
      { $match: { date: { $gte: todayStart, $lte: todayEnd } } },
      { $group: { _id: null, count: { $sum: 1 }, totalAmount: { $sum: '$totalAmount' } } }, // full total for today
    ]),
    getCurrentStockData(),
    StockEntry.aggregate([{ $group: { _id: null, total: { $sum: '$amount' } } }]),
    Sale.aggregate([{ $group: { _id: null, total: { $sum: '$totalAmount' } } }]),
    StockEntry.aggregate([
      { $match: { paymentStatus: { $ne: 'paid' } } },
      { $group: { _id: null, count: { $sum: 1 }, totalPending: { $sum: { $subtract: ['$amount', '$amountPaid'] } } } },
    ]),
  ]);

  let totalBalance = 0;
  for (const a of accounts) {
    const flow = await getAccountBalance(a._id);
    totalBalance += (a.openingBalance ?? 0) + flow;
  }

  const todaySales = todaySalesResult[0] || { count: 0, totalAmount: 0 };
  const totalPurchaseCost = totalPurchaseResult[0]?.total ?? 0;
  const totalSalesRevenue = totalSalesResult[0]?.total ?? 0;
  const overallProfit = totalSalesRevenue - totalPurchaseCost;
  const pendingPayments = pendingPaymentsResult[0] || { count: 0, totalPending: 0 };

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
      profitSummary: {
        totalPurchaseCost,
        totalSalesRevenue,
        overallProfit,
      },
      pendingPayments: {
        count: pendingPayments.count,
        totalAmount: pendingPayments.totalPending,
      },
      stockSummary,
      ...(useLowStock && { lowStockCount }),
    },
  });
};
