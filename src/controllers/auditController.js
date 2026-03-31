import Customer from '../models/Customer.js';
import Supplier from '../models/Supplier.js';
import Mazdoor from '../models/Mazdoor.js';
import Account from '../models/Account.js';
import Sale from '../models/Sale.js';
import StockEntry from '../models/StockEntry.js';
import Transaction from '../models/Transaction.js';
import MachineryPurchase from '../models/MachineryPurchase.js';
import Item from '../models/Item.js';
import RawMaterialHead from '../models/RawMaterialHead.js';
import { getAccountBalance } from './transactionController.js';
import { getCurrentStockData } from './stockController.js';

export const getAuditSummary = async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;
    
    // Strict Date Boundary Fix (Forcing absolute start/end of local calendar day)
    const fromDate = dateFrom ? new Date(`${dateFrom}T00:00:00`) : new Date(0);
    const toDate = dateTo ? new Date(`${dateTo}T23:59:59.999`) : new Date();
    if (!dateTo) toDate.setHours(23, 59, 59, 999);

    const [
      accounts,
      customers,
      suppliers,
      mazdoors,
      machineryTotal,
      stockData,
      expenses,
      taxes,
      allItems,
      rawMaterialHeads
    ] = await Promise.all([
      Account.find({}).lean(),
      Customer.find({}).lean(),
      Supplier.find({}).lean(),
      Mazdoor.find({}).lean(),
      MachineryPurchase.aggregate([
        { $match: { date: { $gte: fromDate, $lte: toDate } } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ]),
      getCurrentStockData(),
      Transaction.aggregate([
        { $match: { date: { $gte: fromDate, $lte: toDate }, type: 'expense' } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ]),
      Transaction.aggregate([
        { $match: { date: { $gte: fromDate, $lte: toDate }, type: 'tax' } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ]),
      Item.find({}).lean(),
      RawMaterialHead.find({}).lean(),
    ]);

    const isPeriodAudit = !!(dateFrom || dateTo);
    const activityMatch = { date: { $gte: fromDate, $lte: toDate } };

    // Calculate Mill Opening Balance (Pichli Wasooli)
    const allMillAccs = accounts.filter(a => a.isDailyKhata || a.isMillKhata);
    const millAccIds = allMillAccs.map(a => a._id);
    const baseOpeningBalance = allMillAccs.reduce((sum, a) => sum + (a.openingBalance || 0), 0);

    const prevTransactions = await Transaction.aggregate([
      { $match: { date: { $lt: fromDate }, type: { $ne: 'accrual' } } },
      {
        $group: {
          _id: null,
          totalIn: { $sum: { $cond: [{ $in: ['$toAccountId', millAccIds] }, '$amount', 0] } },
          totalOut: { $sum: { $cond: [{ $in: ['$fromAccountId', millAccIds] }, '$amount', 0] } },
        }
      }
    ]);
    const openingBalance = baseOpeningBalance + (prevTransactions.length > 0 ? (prevTransactions[0].totalIn - prevTransactions[0].totalOut) : 0);

    // 1. Account Details (Global standing + Period Inflow/Outflow)
    const accountDetails = [];
    let totalCash = 0;
    for (const a of accounts) {
      // Always get In/Out for the selected period
      const periodTrans = await Transaction.aggregate([
        { $match: { ...activityMatch, $or: [{ fromAccountId: a._id }, { toAccountId: a._id }] } },
        { $group: {
          _id: null,
          totalIn: { $sum: { $cond: [{ $eq: ['$toAccountId', a._id] }, '$amount', 0] } },
          totalOut: { $sum: { $cond: [{ $eq: ['$fromAccountId', a._id] }, '$amount', 0] } }
        }}
      ]);

      const tIn = periodTrans[0]?.totalIn || 0;
      const tOut = periodTrans[0]?.totalOut || 0;

      // Point-in-Time Balance calculation (Snapshot as of toDate)
      const flow = await getAccountBalance(a._id, toDate);
      const balance = (a.openingBalance ?? 0) + flow;

      totalCash += balance;
      accountDetails.push({ 
        _id: a._id,
        name: a.name, 
        balance, 
        totalIn: tIn, 
        totalOut: tOut,
        isDailyKhata: !!a.isDailyKhata,
        isMillKhata: !!a.isMillKhata
      });
    }

    // 2. Detailed Customer Balances (Point-in-Time Snapshot)
    const snapshotMatch = { date: { $lte: toDate } };
    
    const customerTransactions = await Transaction.aggregate([
      { $match: { ...snapshotMatch, customerId: { $ne: null } } },
      { $group: { 
        _id: '$customerId', 
        totalIn: { $sum: { $cond: [{ $eq: ['$type', 'deposit'] }, '$amount', 0] } },
        totalOut: { $sum: { $cond: [{ $eq: ['$type', 'withdraw'] }, '$amount', 0] } },
      } }
    ]);
    const customerSales = await Sale.aggregate([
       { $match: snapshotMatch },
       { $group: { _id: '$customerId', total: { $sum: '$totalAmount' } } }
    ]);

    const detailedCustomers = customers.map(c => {
      const trans = customerTransactions.find(b => b._id?.toString() === c._id.toString()) || { totalIn: 0, totalOut: 0 };
      const sales = customerSales.find(s => s._id?.toString() === c._id.toString()) || { total: 0 };
      // Always use opening balance for master audit snapshot
      const balance = (c.openingBalance || 0) + sales.total - trans.totalIn + trans.totalOut;
      return { _id: c._id, name: c.name, balance, phone: c.phone || '' };
    }).sort((a, b) => b.balance - a.balance);

    const totalReceivables = detailedCustomers.filter(c => c.balance > 0).reduce((sum, c) => sum + c.balance, 0);
    const totalCustomerPayables = detailedCustomers.filter(c => c.balance < 0).reduce((sum, c) => sum + Math.abs(c.balance), 0);

    // 3. Detailed Supplier Balances (Point-in-Time Snapshot)
    const supplierTransactions = await Transaction.aggregate([
      { $match: { ...snapshotMatch, supplierId: { $ne: null } } },
      { $group: { 
        _id: '$supplierId', 
        totalIn: { $sum: { $cond: [{ $eq: ['$type', 'deposit'] }, '$amount', 0] } },
        totalOut: { $sum: { $cond: [{ $eq: ['$type', 'withdraw'] }, '$amount', 0] } },
      } }
    ]);
    const supplierPurchases = await StockEntry.aggregate([
      { $match: snapshotMatch },
      { $group: { _id: '$supplierId', total: { $sum: '$amount' } } }
    ]);

    const detailedSuppliers = suppliers.map(s => {
      const trans = supplierTransactions.find(b => b._id?.toString() === s._id.toString()) || { totalIn: 0, totalOut: 0 };
      const purchases = supplierPurchases.find(p => p._id?.toString() === s._id.toString()) || { total: 0 };
      const balance = (s.openingBalance || 0) - purchases.total + trans.totalOut - trans.totalIn;
      return { _id: s._id, name: s.name, balance, phone: s.phone || '' };
    }).sort((a, b) => a.balance - b.balance);

    const totalSupplierPayables = detailedSuppliers.filter(s => s.balance < 0).reduce((sum, s) => sum + Math.abs(s.balance), 0);

    // 4. Detailed Mazdoor Balances (Point-in-Time Snapshot)
    const mazdoorTransactions = await Transaction.aggregate([
      { $match: { ...snapshotMatch, mazdoorId: { $ne: null } } },
      { $group: {
        _id: '$mazdoorId',
        paid: { $sum: { $cond: [{ $in: ['$type', ['withdraw', 'salary']] }, '$amount', 0] } },
        earned: { $sum: { $cond: [{ $in: ['$category', ['salary_accrual', 'mazdoor_expense']] }, '$amount', 0] } }
      }}
    ]);
    const detailedMazdoors = mazdoors.map(m => {
      const stat = mazdoorTransactions.find(s => s._id?.toString() === m._id.toString()) || { paid: 0, earned: 0 };
      const balance = stat.earned - stat.paid;
      return { 
        _id: m._id, 
        name: m.name, 
        balance, 
        earned: stat.earned, 
        paid: stat.paid,
        contact: m.contact || '' 
      };
    }).sort((a, b) => b.balance - a.balance);

    const totalMazdoorPayables = detailedMazdoors.filter(m => m.balance > 0).reduce((sum, m) => sum + m.balance, 0);

    // 5. Detailed Stock & Assets
    const itemPriceMap = new Map(allItems.map(i => [i._id.toString(), i.price || 0]));
    const detailedStock = stockData.map(item => ({
      ...item,
      value: item.quantity * (itemPriceMap.get(item.itemId?.toString()) || 0)
    })).filter(i => i.quantity > 0);
    const totalStockValue = detailedStock.reduce((sum, i) => sum + i.value, 0);

    const detailedMachinery = await MachineryPurchase.find({ 
      date: { $gte: fromDate, $lte: toDate } 
    }).populate('machineryItemId', 'name').populate('supplierId', 'name').lean();

    // 6. Item-Wise Movement Aggregations (Purchases and Sales)
    const [itemPurchaseAgg, itemSaleAgg] = await Promise.all([
      StockEntry.aggregate([
        { $match: activityMatch },
        { $unwind: '$items' },
        { $group: { _id: '$items.itemId', totalPurchase: { $sum: '$items.amount' } } }
      ]),
      Sale.aggregate([
        { $match: activityMatch },
        { $unwind: '$items' },
        { $group: { _id: '$items.itemId', totalSale: { $sum: '$items.totalAmount' } } }
      ])
    ]);

    const detailedItems = allItems.map(item => {
      const p = itemPurchaseAgg.find(x => x._id?.toString() === item._id.toString()) || { totalPurchase: 0 };
      const s = itemSaleAgg.find(x => x._id?.toString() === item._id.toString()) || { totalSale: 0 };
      return {
        _id: item._id,
        name: item.name,
        purchaseVolume: p.totalPurchase,
        saleVolume: s.totalSale
      };
    }).filter(i => i.purchaseVolume > 0 || i.saleVolume > 0);
    
    // 6.b Raw Material Heads Activity Aggregations
    const rawMaterialActivity = await Transaction.aggregate([
      { $match: { ...activityMatch, rawMaterialHeadId: { $ne: null } } },
      { $group: {
        _id: '$rawMaterialHeadId',
        periodCredit: { $sum: { $cond: [{ $in: ['$type', ['deposit', 'sale', 'income']] }, '$amount', 0] } },
        periodDebit: { $sum: { $cond: [{ $in: ['$type', ['withdraw', 'salary', 'tax', 'expense', 'purchase']] }, '$amount', 0] } }
      }}
    ]);

    const detailedRawMaterials = rawMaterialHeads.map(rm => {
      const act = rawMaterialActivity.find(x => x._id?.toString() === rm._id.toString()) || { periodCredit: 0, periodDebit: 0 };
      return {
        _id: rm._id,
        name: rm.name,
        periodCredit: act.periodCredit,
        periodDebit: act.periodDebit
      };
    }).filter(rm => rm.periodCredit > 0 || rm.periodDebit > 0);

    // 7. Detailed Expenses & Taxes
    // 8. Period Transactions for Audit Trail (Len Den Detail)
    const periodTransactions = await Transaction.find({
      date: { $gte: fromDate, $lte: toDate }
    })
    .populate('customerId', 'name')
    .populate('supplierId', 'name')
    .populate('mazdoorId', 'name')
    .populate('fromAccountId', 'name')
    .populate('toAccountId', 'name')
    .populate('expenseTypeId', 'name')
    .populate('taxTypeId', 'name')
    .populate('rawMaterialHeadId', 'name')
    .sort({ date: 1 })
    .lean();

    const detailedExpenses = periodTransactions.filter(t => t.type === 'expense');
    const detailedTaxes = periodTransactions.filter(t => t.type === 'tax');

    // 8. STRICT FILER: Stay Hidden if No Activity in Range
    // We identify who was active via Transactions, Sales, or Purchases
    const activeSaleCustomerIds = (await Sale.find({ date: { $gte: fromDate, $lte: toDate } }).select('customerId')).map(s => s.customerId?.toString());
    const activePurchaseSupplierIds = (await StockEntry.find({ date: { $gte: fromDate, $lte: toDate } }).select('supplierId')).map(s => s.supplierId?.toString());
    
    const activeTransCustomerIds = periodTransactions.map(t => t.customerId?._id?.toString()).filter(Boolean);
    const activeTransSupplierIds = periodTransactions.map(t => t.supplierId?._id?.toString()).filter(Boolean);
    const activeTransMazdoorIds = periodTransactions.map(t => t.mazdoorId?._id?.toString()).filter(Boolean);

    const allActiveCustomerIds = new Set([...activeSaleCustomerIds, ...activeTransCustomerIds]);
    const allActiveSupplierIds = new Set([...activePurchaseSupplierIds, ...activeTransSupplierIds]);
    const allActiveMazdoorIds = new Set([...activeTransMazdoorIds]);

    const filteredCustomers = detailedCustomers.filter(c => allActiveCustomerIds.has(c._id.toString()));
    const filteredSuppliers = detailedSuppliers.filter(s => allActiveSupplierIds.has(s._id.toString()));
    const filteredMazdoors = detailedMazdoors.filter(m => allActiveMazdoorIds.has(m._id.toString()));

    // Recalculate totals based on filtered set for strict Period Scenario alignment
    const scenarioReceivables = filteredCustomers.filter(c => c.balance > 0).reduce((sum, c) => sum + c.balance, 0);
    const scenarioPayables = (filteredCustomers.filter(c => c.balance < 0).reduce((sum, c) => sum + Math.abs(c.balance), 0)) +
                             (filteredSuppliers.filter(s => s.balance < 0).reduce((sum, s) => sum + Math.abs(s.balance), 0)) +
                             (filteredMazdoors.filter(m => m.balance > 0).reduce((sum, m) => sum + m.balance, 0));

    res.json({
      success: true,
      data: {
        openingBalance,
        totalCash,
        totalReceivables: scenarioReceivables,
        totalPayables: scenarioPayables,
        totalStockValue,
        totalMachineryValue: machineryTotal[0]?.total || 0,
        
        customers: filteredCustomers,
        suppliers: filteredSuppliers,
        mazdoors: filteredMazdoors,
        stock: detailedStock,
        machinery: detailedMachinery,
        expenses: detailedExpenses,
        taxes: detailedTaxes,
        accounts: accountDetails,
        items: detailedItems,
        rawMaterials: detailedRawMaterials,
        periodTransactions
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
