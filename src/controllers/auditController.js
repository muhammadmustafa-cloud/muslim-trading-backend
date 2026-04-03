import mongoose from 'mongoose';
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
import { toUTCStartOfDay, toUTCEndOfDay } from '../utils/dateUtils.js';

export const getAuditSummary = async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;
    
    // Strict Date Boundary Fix (Forcing absolute start/end of UTC day)
    const toDateStr = dateTo || new Date().toISOString().slice(0, 10);
    const fromDateStr = dateFrom || toDateStr;
    const fromDate = toUTCStartOfDay(fromDateStr);
    const toDate = toUTCEndOfDay(toDateStr);

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

    // Calculate Mill Opening Balance (Pichli Wasooli) - Balance BEFORE the start of the selected range.
    const opBalBoundary = dateFrom ? toUTCStartOfDay(dateFrom) : new Date(0);

    const allMillAccs = accounts.filter(a => a.isDailyKhata || a.isMillKhata);
    const millAccIds = allMillAccs.map(a => a._id);
    const baseOpeningBalance = allMillAccs.reduce((sum, a) => sum + (a.openingBalance || 0), 0);

    const prevTransactions = await Transaction.aggregate([
      { $match: { date: { $lt: opBalBoundary }, type: { $ne: 'accrual' } } },
      {
        $group: {
          _id: null,
          totalIn: { 
            $sum: { 
              $cond: [
                { $and: [
                  { $in: ['$toAccountId', millAccIds] }, // Entering Mill
                  { $not: { $in: ['$fromAccountId', millAccIds] } } // Not from another Mill
                ]}, 
                '$amount', 
                0
              ] 
            } 
          },
          totalOut: { 
            $sum: { 
              $cond: [
                { $and: [
                  { $in: ['$fromAccountId', millAccIds] }, // Leaving Mill
                  { $not: { $in: ['$toAccountId', millAccIds] } } // Not to another Mill
                ]}, 
                '$amount', 
                0
              ] 
            } 
          },
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
          totalIn:  { $sum: { $cond: [{ $eq: ['$toAccountId',   a._id] }, '$amount', 0] } },
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

    const periodMatch = activityMatch;
    const periodCustomerTrans = await Transaction.aggregate([
      { $match: { ...periodMatch, customerId: { $ne: null } } },
      { $group: { 
        _id: '$customerId', 
        totalIn: { $sum: { $cond: [{ $eq: ['$type', 'deposit'] }, '$amount', 0] } },
        totalOut: { $sum: { $cond: [{ $eq: ['$type', 'withdraw'] }, '$amount', 0] } },
      } }
    ]);
    const periodCustomerSales = await Sale.aggregate([
       { $match: periodMatch },
       { $group: { _id: '$customerId', total: { $sum: '$totalAmount' } } }
    ]);

    const detailedCustomers = customers.map(c => {
      const snapTrans = customerTransactions.find(b => b._id?.toString() === c._id.toString()) || { totalIn: 0, totalOut: 0 };
      const snapSales = customerSales.find(s => s._id?.toString() === c._id.toString()) || { total: 0 };
      const pTrans = periodCustomerTrans.find(b => b._id?.toString() === c._id.toString()) || { totalIn: 0, totalOut: 0 };
      const pSales = periodCustomerSales.find(s => s._id?.toString() === c._id.toString()) || { total: 0 };

      const balance = (c.openingBalance || 0) + snapSales.total - snapTrans.totalIn + snapTrans.totalOut;
      return { 
        _id: c._id, 
        name: c.name, 
        balance, 
        phone: c.phone || '',
        periodIn: pTrans.totalIn, // Movement In
        periodOut: pSales.total + pTrans.totalOut // Movement Out (Sales added here)
      };
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

    const periodSupplierTrans = await Transaction.aggregate([
      { $match: { ...periodMatch, supplierId: { $ne: null } } },
      { $group: { 
        _id: '$supplierId', 
        totalIn: { $sum: { $cond: [{ $eq: ['$type', 'deposit'] }, '$amount', 0] } },
        totalOut: { $sum: { $cond: [{ $eq: ['$type', 'withdraw'] }, '$amount', 0] } },
      } }
    ]);
    const periodSupplierPurchases = await StockEntry.aggregate([
      { $match: periodMatch },
      { $group: { _id: '$supplierId', total: { $sum: '$amount' } } }
    ]);

    const detailedSuppliers = suppliers.map(s => {
      const snapTrans = supplierTransactions.find(b => b._id?.toString() === s._id.toString()) || { totalIn: 0, totalOut: 0 };
      const snapPurch = supplierPurchases.find(p => p._id?.toString() === s._id.toString()) || { total: 0 };
      const pTrans = periodSupplierTrans.find(b => b._id?.toString() === s._id.toString()) || { totalIn: 0, totalOut: 0 };
      const pPurch = periodSupplierPurchases.find(p => p._id?.toString() === s._id.toString()) || { total: 0 };

      const balance = (s.openingBalance || 0) - snapPurch.total + snapTrans.totalOut - snapTrans.totalIn;
      return { 
        _id: s._id, 
        name: s.name, 
        balance, 
        phone: s.phone || '',
        periodIn: pPurch.total + pTrans.totalIn, // Movement In (Purchase added here)
        periodOut: pTrans.totalOut // Movement Out
      };
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

    const periodMazdoorTrans = await Transaction.aggregate([
      { $match: { ...periodMatch, mazdoorId: { $ne: null } } },
      { $group: {
        _id: '$mazdoorId',
        paid: { $sum: { $cond: [{ $in: ['$type', ['withdraw', 'salary']] }, '$amount', 0] } },
        earned: { $sum: { $cond: [{ $in: ['$category', ['salary_accrual', 'mazdoor_expense']] }, '$amount', 0] } }
      }}
    ]);

    const detailedMazdoors = mazdoors.map(m => {
      const snap = mazdoorTransactions.find(s => s._id?.toString() === m._id.toString()) || { paid: 0, earned: 0 };
      const pStat = periodMazdoorTrans.find(s => s._id?.toString() === m._id.toString()) || { paid: 0, earned: 0 };
      
      const balance = snap.earned - snap.paid;
      return { 
        _id: m._id, 
        name: m.name, 
        balance, 
        earned: snap.earned, 
        paid: snap.paid,
        periodEarned: pStat.earned,
        periodPaid: pStat.paid
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

/**
 * Consolidated Ledger Report Data (Detailed party-wise ledger snippets)
 */
export const getConsolidatedLedgers = async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;
    const toDateStr = dateTo || new Date().toISOString().slice(0, 10);
    const fromDateStr = dateFrom || toDateStr;
    const fromDate = toUTCStartOfDay(fromDateStr);
    const toDate = toUTCEndOfDay(toDateStr);

    const activityMatch = { date: { $gte: fromDate, $lte: toDate } };


    // 1. Identify all active entities in this range
    const [
      activeTrans,
      activeSales,
      activePurchases,
      allCustomers,
      allSuppliers,
      allMazdoors,
      allExpenseTypes,
      allTaxTypes,
      allRawMaterialHeads,
      allAccounts,
      allItems
    ] = await Promise.all([
      Transaction.find(activityMatch).lean(),
      Sale.find(activityMatch).populate('customerId', 'name address phone').populate('items.itemId', 'name').populate('accountId', 'name').lean(),
      StockEntry.find(activityMatch).populate('supplierId', 'name address phone').populate('items.itemId', 'name').populate('accountId', 'name').lean(),
      Customer.find({}).lean(),
      Supplier.find({}).lean(),
      Mazdoor.find({}).lean(),
      mongoose.model('ExpenseType').find({}).lean(),
      mongoose.model('TaxType').find({}).lean(),
      RawMaterialHead.find({}).lean(),
      Account.find({}).lean(),
      Item.find({}).lean()
    ]);

    const activeCustomerIds = new Set([
      ...activeTrans.map(t => t.customerId?._id?.toString() || t.customerId?.toString()).filter(Boolean),
      ...activeSales.map(s => s.customerId?._id?.toString() || s.customerId?.toString()).filter(Boolean)
    ]);
    const activeSupplierIds = new Set([
      ...activeTrans.map(t => t.supplierId?._id?.toString() || t.supplierId?.toString()).filter(Boolean),
      ...activePurchases.map(p => p.supplierId?._id?.toString() || p.supplierId?.toString()).filter(Boolean)
    ]);
    const activeMazdoorIds = new Set([...activeTrans.map(t => t.mazdoorId?.toString()).filter(Boolean)]);
    const activeExpenseTypeIds = new Set([...activeTrans.map(t => t.expenseTypeId?.toString()).filter(Boolean)]);
    const activeTaxTypeIds = new Set([...activeTrans.map(t => t.taxTypeId?.toString()).filter(Boolean)]);
    const activeRawMaterialHeadIds = new Set([...activeTrans.map(t => t.rawMaterialHeadId?.toString()).filter(Boolean)]);
    const activeAccountIds = new Set([
      ...activeTrans.map(t => t.fromAccountId?.toString()).filter(Boolean),
      ...activeTrans.map(t => t.toAccountId?.toString()).filter(Boolean)
    ]);
    const activeItemIds = new Set([
      ...activeSales.reduce((acc, s) => [...acc, ...(s.items || []).map(i => i.itemId?._id?.toString() || i.itemId?.toString())], []),
      ...activePurchases.reduce((acc, p) => [...acc, ...(p.items || []).map(i => i.itemId?._id?.toString() || i.itemId?.toString())], [])
    ].filter(Boolean));

    const consolidatedData = {
      customers: [],
      suppliers: [],
      mazdoors: [],
      expenses: [],
      taxes: [],
      rawMaterials: [],
      accounts: [],
      items: [],
      salesInvoices: activeSales,
      purchaseInvoices: activePurchases
    };

    // Helper: Calculation of individual entity's opening balance as of fromDate
    // Safe ID extractor: works for both plain ObjectId and populated objects
    const getId = (ref) => ref?._id?.toString() || ref?.toString() || null;

    const getEntityOpeningBalance = async (type, id, openingVal = 0) => {
      const matchBefore = { date: { $lt: fromDate } };
      let balance = Number(openingVal) || 0;

      if (type === 'customer') {
        const [tIn, tOut, sTotal] = await Promise.all([
          Transaction.aggregate([{ $match: { ...matchBefore, customerId: id, type: 'deposit' } }, { $group: { _id: null, sum: { $sum: '$amount' } } }]),
          Transaction.aggregate([{ $match: { ...matchBefore, customerId: id, type: 'withdraw' } }, { $group: { _id: null, sum: { $sum: '$amount' } } }]),
          Sale.aggregate([{ $match: { ...matchBefore, customerId: id } }, { $group: { _id: null, sum: { $sum: '$totalAmount' } } }])
        ]);
        balance += (sTotal[0]?.sum || 0) - (tIn[0]?.sum || 0) + (tOut[0]?.sum || 0);
      } else if (type === 'supplier') {
        const [tIn, tOut, pTotal] = await Promise.all([
          Transaction.aggregate([{ $match: { ...matchBefore, supplierId: id, type: 'deposit' } }, { $group: { _id: null, sum: { $sum: '$amount' } } }]),
          Transaction.aggregate([{ $match: { ...matchBefore, supplierId: id, type: 'withdraw' } }, { $group: { _id: null, sum: { $sum: '$amount' } } }]),
          StockEntry.aggregate([{ $match: { ...matchBefore, supplierId: id } }, { $group: { _id: null, sum: { $sum: '$amount' } } }])
        ]);
        balance += (tOut[0]?.sum || 0) - (tIn[0]?.sum || 0) - (pTotal[0]?.sum || 0);
      } else if (type === 'mazdoor') {
        const [paid, earned] = await Promise.all([
          Transaction.aggregate([{ $match: { ...matchBefore, mazdoorId: id, type: { $in: ['withdraw', 'salary'] } } }, { $group: { _id: null, sum: { $sum: '$amount' } } }]),
          Transaction.aggregate([{ $match: { ...matchBefore, mazdoorId: id, category: { $in: ['salary_accrual', 'mazdoor_expense'] } } }, { $group: { _id: null, sum: { $sum: '$amount' } } }])
        ]);
        balance += (earned[0]?.sum || 0) - (paid[0]?.sum || 0);
      } else if (type === 'expense') {
        const tx = await Transaction.aggregate([{ $match: { ...matchBefore, expenseTypeId: id } }, { $group: { _id: null, sum: { $sum: '$amount' } } }]);
        balance += (tx[0]?.sum || 0);
      } else if (type === 'tax') {
        const tx = await Transaction.aggregate([{ $match: { ...matchBefore, taxTypeId: id } }, { $group: { _id: null, sum: { $sum: '$amount' } } }]);
        balance += (tx[0]?.sum || 0);
      } else if (type === 'raw') {
        const tx = await Transaction.aggregate([
          { $match: { ...matchBefore, rawMaterialHeadId: id } },
          { $group: {
            _id: null,
            sumIn: { $sum: { $cond: [{ $in: ['$type', ['deposit', 'sale', 'income']] }, '$amount', 0] } },
            sumOut: { $sum: { $cond: [{ $in: ['$type', ['withdraw', 'salary', 'tax', 'expense', 'purchase']] }, '$amount', 0] } }
          }}
        ]);
        balance += (tx[0]?.sumIn || 0) - (tx[0]?.sumOut || 0);
      } else if (type === 'account') {
        const tx = await Transaction.aggregate([
          { $match: { ...matchBefore, $or: [{ fromAccountId: id }, { toAccountId: id }] } },
          { $group: {
            _id: null,
            totalIn: { $sum: { $cond: [{ $eq: ['$toAccountId', id] }, '$amount', 0] } },
            totalOut: { $sum: { $cond: [{ $eq: ['$fromAccountId', id] }, '$amount', 0] } }
          }}
        ]);
        balance += (tx[0]?.totalIn || 0) - (tx[0]?.totalOut || 0);
      } else if (type === 'item') {
        const itemObjId = new mongoose.Types.ObjectId(id);
        const [sales, purchases] = await Promise.all([
          Sale.aggregate([{ $match: matchBefore }, { $unwind: '$items' }, { $match: { 'items.itemId': itemObjId } }, { $group: { _id: null, sum: { $sum: '$items.totalAmount' } } }]),
          StockEntry.aggregate([{ $match: matchBefore }, { $unwind: '$items' }, { $match: { 'items.itemId': itemObjId } }, { $group: { _id: null, sum: { $sum: '$items.amount' } } }])
        ]);
        balance += (sales[0]?.sum || 0) - (purchases[0]?.sum || 0);
      }

      return balance;
    };

    // PROCESS CUSTOMERS
    for (const cId of activeCustomerIds) {
      const party = allCustomers.find(c => c._id.toString() === cId);
      if (!party) continue;
      const op = await getEntityOpeningBalance('customer', party._id, party.openingBalance);
      const trans = activeTrans.filter(t => getId(t.customerId) === cId);
      const sales = activeSales.filter(s => getId(s.customerId) === cId);
      
      const ledger = [];
      sales.forEach(s => ledger.push({ date: s.date, description: `Sale Invoice (Truck: ${s.truckNumber || '-'})`, debit: s.totalAmount, credit: 0, bags: (s.items || []).reduce((sum, it) => sum + (it.kattay || 0), 0) }));
      trans.forEach(t => ledger.push({ date: t.date, description: `Payment: ${t.note || (t.type === 'deposit' ? 'Received' : 'Paid')}`, debit: t.type === 'withdraw' ? t.amount : 0, credit: t.type === 'deposit' ? t.amount : 0, bags: 0 }));
      ledger.sort((a, b) => new Date(a.date) - new Date(b.date));

      consolidatedData.customers.push({ name: party.name, openingBalance: op, ledger });
    }

    // PROCESS SUPPLIERS
    for (const sId of activeSupplierIds) {
      const party = allSuppliers.find(s => s._id.toString() === sId);
      if (!party) continue;
      const op = await getEntityOpeningBalance('supplier', party._id, party.openingBalance);
      const trans = activeTrans.filter(t => getId(t.supplierId) === sId);
      const purchases = activePurchases.filter(p => getId(p.supplierId) === sId);

      const ledger = [];
      purchases.forEach(p => ledger.push({ date: p.date, description: `Purchase: ${p._id.toString().slice(-6)} (Truck: ${p.truckNumber || '-'})`, debit: 0, credit: p.amount, bags: (p.items || []).reduce((sum, it) => sum + (it.kattay || 0), 0) }));
      trans.forEach(t => ledger.push({ date: t.date, description: `Payment: ${t.note || (t.type === 'withdraw' ? 'Paid' : 'Received')}`, debit: t.type === 'withdraw' ? t.amount : 0, credit: t.type === 'deposit' ? t.amount : 0, bags: 0 }));
      ledger.sort((a, b) => new Date(a.date) - new Date(b.date));

      consolidatedData.suppliers.push({ name: party.name, openingBalance: op, ledger });
    }

    // PROCESS MAZDOORS
    for (const mId of activeMazdoorIds) {
      const party = allMazdoors.find(m => m._id.toString() === mId);
      if (!party) continue;
      const op = await getEntityOpeningBalance('mazdoor', party._id, 0);
      const trans = activeTrans.filter(t => t.mazdoorId?.toString() === mId);
      const ledger = [];
      trans.forEach(t => {
        const isEarned = t.category === 'salary_accrual' || t.category === 'mazdoor_expense';
        ledger.push({ date: t.date, description: t.note || (isEarned ? 'Salary Accrued' : 'Payment Made'), debit: !isEarned ? t.amount : 0, credit: isEarned ? t.amount : 0 });
      });
      ledger.sort((a, b) => new Date(a.date) - new Date(b.date));
      consolidatedData.mazdoors.push({ name: party.name, openingBalance: op, ledger });
    }

    // PROCESS EXPENSES
    for (const eId of activeExpenseTypeIds) {
      const party = allExpenseTypes.find(e => e._id.toString() === eId);
      if (!party) continue;
      const op = await getEntityOpeningBalance('expense', party._id, 0);
      const trans = activeTrans.filter(t => t.expenseTypeId?.toString() === eId);
      const ledger = trans.map(t => ({ date: t.date, description: t.note || 'General Expense', debit: t.amount, credit: 0 }));
      ledger.sort((a, b) => new Date(a.date) - new Date(b.date));
      consolidatedData.expenses.push({ name: party.name, openingBalance: op, ledger });
    }

    // PROCESS RAW MATERIALS
    for (const rwId of activeRawMaterialHeadIds) {
      const party = allRawMaterialHeads.find(rw => rw._id.toString() === rwId);
      if (!party) continue;
      const op = await getEntityOpeningBalance('raw', party._id, 0);
      const trans = activeTrans.filter(t => t.rawMaterialHeadId?.toString() === rwId);
      const ledger = trans.map(t => {
        const isIn = t.type === 'deposit' || t.type === 'sale' || t.type === 'income';
        return { date: t.date, description: t.note || (isIn ? 'Stock In' : 'Stock Out'), debit: !isIn ? t.amount : 0, credit: isIn ? t.amount : 0 };
      });
      ledger.sort((a, b) => new Date(a.date) - new Date(b.date));
      consolidatedData.rawMaterials.push({ name: party.name, openingBalance: op, ledger });
    }

    // PROCESS ACCOUNTS
    for (const aId of activeAccountIds) {
      const party = allAccounts.find(a => a._id.toString() === aId);
      if (!party) continue;

      // Exclude internal/system accounts
      const lowerName = (party.name || "").toLowerCase();
      if (lowerName.includes("mill khata") || lowerName.includes("daily khata")) continue;

      const op = await getEntityOpeningBalance('account', party._id, party.openingBalance);
      const trans = activeTrans.filter(t => t.fromAccountId?.toString() === aId || t.toAccountId?.toString() === aId);
      const ledger = trans.map(t => {
        const isIn = t.fromAccountId?.toString() === aId || t.fromAccountId?._id?.toString() === aId; // Source (From) = Credit/In
        return { date: t.date, description: t.note || (isIn ? 'Inflow' : 'Outflow'), debit: isIn ? 0 : t.amount, credit: isIn ? t.amount : 0 };
      });
      ledger.sort((a, b) => new Date(a.date) - new Date(b.date));
      consolidatedData.accounts.push({ name: party.name, openingBalance: op, ledger });
    }

    // PROCESS ITEMS
    const itemObjIdSet = Array.from(activeItemIds).map(id => new mongoose.Types.ObjectId(id));
    for (const iId of activeItemIds) {
      const party = allItems.find(i => i._id.toString() === iId);
      if (!party) continue;
      const op = await getEntityOpeningBalance('item', party._id, 0); // No real opening monetory val for item usually, just turnover
      
      const itemSales = activeSales.filter(s => (s.items || []).some(item => getId(item.itemId) === iId));
      const itemPurchases = activePurchases.filter(p => (p.items || []).some(item => getId(item.itemId) === iId));

      const ledger = [];
      itemSales.forEach(s => {
         const match = s.items.find(it => getId(it.itemId) === iId);
         const custName = s.customerId?.name || allCustomers.find(c => c._id.toString() === getId(s.customerId))?.name || "Customer";
         ledger.push({ date: s.date, description: `Sale to ${custName} (Truck: ${s.truckNumber || '-'})`, debit: match.totalAmount, credit: 0, status: 'sold', bags: match.kattay || 0, weight: match.quantity || 0 });
      });
      itemPurchases.forEach(p => {
         const match = p.items.find(it => getId(it.itemId) === iId);
         const supName = p.supplierId?.name || allSuppliers.find(sup => sup._id.toString() === getId(p.supplierId))?.name || "Supplier";
         ledger.push({ date: p.date, description: `Purchase from ${supName} (Truck: ${p.truckNumber || '-'})`, debit: 0, credit: match.amount, status: 'purchased', bags: match.kattay || 0, weight: match.quantity || match.receivedWeight || 0 });
      });

      ledger.sort((a, b) => new Date(a.date) - new Date(b.date));
      consolidatedData.items.push({ name: party.name, openingBalance: op, ledger });
    }

    res.json({ success: true, data: consolidatedData });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
