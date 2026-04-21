import mongoose from 'mongoose';
import { getAccountBalance } from './transactionController.js';
import { getCurrentStockData } from './stockController.js';
import { toUTCStartOfDay, toUTCEndOfDay } from '../utils/dateUtils.js';

export const getAuditSummary = async (req, res) => {
  try {
    const { 
      Account, Customer, Supplier, Mazdoor, 
      MachineryPurchase, Transaction, Item, 
      RawMaterialHead, Sale, StockEntry, DailyDastiEntry
    } = req.models;

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
      getCurrentStockData(req.models),

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
    const opBalBoundary = fromDate;

    const allMillAccs = accounts.filter(a => a.isDailyKhata || a.isMillKhata);
    const millAccIds = allMillAccs.map(a => a._id);
    const baseOpeningBalance = allMillAccs.reduce((sum, a) => sum + (a.openingBalance || 0), 0);

    // ----------------------------------------------------
    // PERFECT UNIVERSAL OPENING BALANCE SYNCHRONIZATION
    // ----------------------------------------------------
    // Convert millAccIds to strings for reliable comparison
    const millAccIdStrings = millAccIds.map(id => id.toString());

    const prevTransactions = await Transaction.aggregate([
      { $match: { date: { $lt: opBalBoundary }, type: { $ne: 'accrual' } } },
      {
        $addFields: {
          // Convert ObjectIds to strings for reliable comparison
          toAccIdStr: { $toString: '$toAccountId' },
          fromAccIdStr: { $toString: '$fromAccountId' }
        }
      },
      {
        $group: {
          _id: null,
          totalIn: {
            $sum: {
              $cond: [
                { $in: ['$toAccIdStr', millAccIdStrings] }, // Standard Inflow: Money TO mill accounts
                '$amount',
                0
              ]
            }
          },
          totalOut: {
            $sum: {
              $cond: [
                { $in: ['$fromAccIdStr', millAccIdStrings] }, // Standard Outflow
                '$amount',
                0
              ]
            }
          }
        }
      }
    ]);
    // Calculate Dasti entries effect before fromDate (for opening balance)
    const prevDastiAgg = await DailyDastiEntry.aggregate([
      { $match: { date: { $lt: opBalBoundary } } },
      {
        $group: {
          _id: null,
          totalCredit: { $sum: { $cond: [{ $eq: ['$type', 'credit'] }, '$amount', 0] } },
          totalDebit: { $sum: { $cond: [{ $eq: ['$type', 'debit'] }, '$amount', 0] } }
        }
      }
    ]);
    const prevDastiEffect = prevDastiAgg.length > 0 ? (prevDastiAgg[0].totalCredit - prevDastiAgg[0].totalDebit) : 0;

    const prevTxCalc = prevTransactions.length > 0 ? (prevTransactions[0].totalIn - prevTransactions[0].totalOut) : 0;
    const openingBalance = baseOpeningBalance + prevTxCalc + prevDastiEffect;

    console.log('=== AUDIT OPENING BALANCE DEBUG ===');
    console.log('Date range:', fromDate, 'to', toDate);
    console.log('Base opening balance (from accounts):', baseOpeningBalance);
    console.log('Mill account IDs:', millAccIdStrings);
    console.log('Previous transactions aggregation:', prevTransactions);
    console.log('Prev Tx calculation (totalIn - totalOut):', prevTxCalc);
    console.log('Prev Dasti entries effect (credit - debit):', prevDastiEffect);
    console.log('Final openingBalance:', openingBalance);
    console.log('=====================================');

    // 1. Bank & Cash Account Details (Periodic Activity Sync)
    // We aggregate ALL accounts in one pass for precision and dashboard alignment
    const allAccountMovements = await Transaction.aggregate([
      { $match: { ...activityMatch, $or: [
          { fromAccountId: { $in: accounts.map(a => a._id) } },
          { toAccountId:   { $in: accounts.map(a => a._id) } }
      ]}},
      { $project: {
          amount: 1,
          fromAccountId: 1,
          toAccountId: 1,
          // Extract matching IDs as strings for reliable comparison
          fromIdStr: { $toString: '$fromAccountId' },
          toIdStr:   { $toString: '$toAccountId' }
      }},
      { $facet: {
          outgoing: [
            { $group: { _id: '$fromAccountId', total: { $sum: '$amount' } } }
          ],
          incoming: [
            // SAHI DASHBOARD LOGIC: Priority to Outflow. 
            // If it's a self-transfer (from==to), only count it as outgoing.
            { $match: { $expr: { $ne: ['$fromAccountId', '$toAccountId'] } } },
            { $group: { _id: '$toAccountId', total: { $sum: '$amount' } } }
          ]
      }}
    ]);

    const outMap = new Map(allAccountMovements[0].outgoing.filter(x => x._id).map(x => [x._id.toString(), x.total]));
    const inMap  = new Map(allAccountMovements[0].incoming.filter(x => x._id).map(x => [x._id.toString(), x.total]));

    const accountDetails = [];
    let totalCash = 0;

    for (const a of accounts) {
      const tOut = outMap.get(a._id.toString()) || 0;
      const tIn  = inMap.get(a._id.toString()) || 0;
      const periodBalance = tOut - tIn;

      // Current balance snapshot at the END of the period
      const flow = await getAccountBalance(Transaction, a._id, toDate);

      const balanceSnapshot = (a.openingBalance ?? 0) + flow;

      accountDetails.push({
        _id: a._id,
        name: a.name,
        type: a.type,
        balance: balanceSnapshot,
        periodBalance,
        tIn,
        tOut,
        isDailyKhata: !!a.isDailyKhata,
        isMillKhata: !!a.isMillKhata
      });

      if (!a.isDailyKhata && !a.isMillKhata) {
         totalCash += balanceSnapshot;
      }
    }

    // 2. Detailed Customer Balances (Point-in-Time Snapshot)
    const snapshotMatch = { date: { $lte: toDate } };
    
    // SAHI: Count ALL Deposits/Transfers as money in, ALL Withdraws as money out (Ledger match)
    const customerTransactions = await Transaction.aggregate([
      { $match: { ...snapshotMatch, customerId: { $ne: null } } },
      { $group: { 
        _id: '$customerId', 
        totalIn: { $sum: { $cond: [{ $or: [{ $eq: ['$type', 'deposit'] }, { $eq: ['$type', 'transfer'] }, { $eq: ['$type', 'income'] }] }, '$amount', 0] } },
        totalOut: { $sum: { $cond: [{ $or: [{ $eq: ['$type', 'withdraw'] }, { $eq: ['$type', 'expense'] }] }, '$amount', 0] } },
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
        totalIn: { $sum: { $cond: [{ $or: [{ $eq: ['$type', 'deposit'] }, { $eq: ['$type', 'transfer'] }, { $eq: ['$type', 'income'] }] }, '$amount', 0] } },
        totalOut: { $sum: { $cond: [{ $or: [{ $eq: ['$type', 'withdraw'] }, { $eq: ['$type', 'expense'] }] }, '$amount', 0] } },
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
        periodIn: pTrans.totalIn, // RECEIVED in period
        periodOut: pSales.total + pTrans.totalOut // BILLED in period
      };
    }).sort((a, b) => b.balance - a.balance);

    const totalReceivables = detailedCustomers.filter(c => c.balance > 0).reduce((sum, c) => sum + c.balance, 0);
    const totalCustomerPayables = detailedCustomers.filter(c => c.balance < 0).reduce((sum, c) => sum + Math.abs(c.balance), 0);

    // 3. Detailed Supplier Balances (Point-in-Time Snapshot)
    const supplierTransactions = await Transaction.aggregate([
      { $match: { ...snapshotMatch, supplierId: { $ne: null } } },
      { $group: { 
        _id: '$supplierId', 
        totalIn: { $sum: { $cond: [{ $or: [{ $eq: ['$type', 'deposit'] }, { $eq: ['$type', 'income'] }] }, '$amount', 0] } },
        totalOut: { $sum: { $cond: [{ $or: [{ $eq: ['$type', 'withdraw'] }, { $eq: ['$type', 'expense'] }, { $eq: ['$type', 'transfer'] }] }, '$amount', 0] } },
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
        totalIn: { $sum: { $cond: [{ $or: [{ $eq: ['$type', 'deposit'] }, { $eq: ['$type', 'income'] }] }, '$amount', 0] } },
        totalOut: { $sum: { $cond: [{ $or: [{ $eq: ['$type', 'withdraw'] }, { $eq: ['$type', 'expense'] }, { $eq: ['$type', 'transfer'] }] }, '$amount', 0] } },
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
        periodIn: pPurch.total + pTrans.totalIn, // PAYABLE (Inward)
        periodOut: pTrans.totalOut // PAID (Outward)
      };
    }).sort((a, b) => a.balance - b.balance);

    const totalSupplierPayables = detailedSuppliers.filter(s => s.balance < 0).reduce((sum, s) => sum + Math.abs(s.balance), 0);

    // 4. Detailed Mazdoor Balances (Point-in-Time Snapshot)
    const mazdoorTransactions = await Transaction.aggregate([
      { $match: { ...snapshotMatch, mazdoorId: { $ne: null } } },
      { $group: {
        _id: '$mazdoorId',
        // PAIDS: Withdrawals, salary transactions, or transfers (money going OUT to mazdoor)
        paid: { $sum: { $cond: [{ $or: [{ $in: ['$type', ['withdraw', 'salary', 'transfer']] }] }, '$amount', 0] } },
        // EARNED: Any transaction where they provided value (accruals or mazdoor_expense)
        earned: { $sum: { $cond: [{ $or: [{ $in: ['$type', ['deposit', 'income']] }, { $in: ['$category', ['salary_accrual', 'mazdoor_expense']] }] }, '$amount', 0] } }
      }}
    ]);

    const periodMazdoorTrans = await Transaction.aggregate([
      { $match: { ...periodMatch, mazdoorId: { $ne: null } } },
      { $group: {
        _id: '$mazdoorId',
        paid: { $sum: { $cond: [{ $or: [{ $in: ['$type', ['withdraw', 'salary', 'transfer']] }] }, '$amount', 0] } },
        earned: { $sum: { $cond: [{ $or: [{ $in: ['$type', ['deposit', 'income']] }, { $in: ['$category', ['salary_accrual', 'mazdoor_expense']] }] }, '$amount', 0] } }
      }}
    ]);

    const detailedMazdoors = mazdoors.map(m => {
      const snap = mazdoorTransactions.find(s => s._id?.toString() === m._id.toString()) || { paid: 0, earned: 0 };
      const pStat = periodMazdoorTrans.find(s => s._id?.toString() === m._id.toString()) || { paid: 0, earned: 0 };
      
      const balance = (m.openingBalance || 0) + snap.earned - snap.paid;
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

    // ----------------------------------------------------
    // PERFECT UNIVERSAL BAQAYA SYNCHRONIZATION
    // ----------------------------------------------------
    // We replicate the exact historical tracking logic of dailyMemoController
    // preventing mathematical deviations like the Mill->Bank proxy inflations.
    // Note: millAccIdStrings already defined above
    const allTimeAgg = await Transaction.aggregate([
      { $match: { date: { $lte: toDate }, type: { $ne: 'accrual' } } },
      {
        $addFields: {
          // Convert ObjectIds to strings for reliable comparison
          toAccIdStr: { $toString: '$toAccountId' },
          fromAccIdStr: { $toString: '$fromAccountId' }
        }
      },
      {
        $group: {
          _id: null,
          totalAllTimeIn: {
            $sum: {
              $cond: [
                { $in: ['$toAccIdStr', millAccIdStrings] }, // Standard Inflow: Money TO mill accounts
                '$amount',
                0
              ]
            }
          },
          totalAllTimeOut: {
            $sum: {
              $cond: [
                { $in: ['$fromAccIdStr', millAccIdStrings] },
                '$amount',
                0
              ]
            }
          }
        }
      }
    ]);
    // Calculate Dasti entries effect up to toDate (for universal baqaya)
    const allTimeDastiAgg = await DailyDastiEntry.aggregate([
      { $match: { date: { $lte: toDate } } },
      {
        $group: {
          _id: null,
          totalCredit: { $sum: { $cond: [{ $eq: ['$type', 'credit'] }, '$amount', 0] } },
          totalDebit: { $sum: { $cond: [{ $eq: ['$type', 'debit'] }, '$amount', 0] } }
        }
      }
    ]);
    const allTimeDastiEffect = allTimeDastiAgg.length > 0 ? (allTimeDastiAgg[0].totalCredit - allTimeDastiAgg[0].totalDebit) : 0;

    const universalBaqaya = baseOpeningBalance + 
      (allTimeAgg.length > 0 ? (allTimeAgg[0].totalAllTimeIn - allTimeAgg[0].totalAllTimeOut) : 0) + 
      allTimeDastiEffect;

    console.log('=== AUDIT UNIVERSAL BAQAYA DEBUG ===');
    console.log('All-time transactions (In - Out):', allTimeAgg.length > 0 ? (allTimeAgg[0].totalAllTimeIn - allTimeAgg[0].totalAllTimeOut) : 0);
    console.log('All-time Dasti effect (credit - debit):', allTimeDastiEffect);
    console.log('Final universalBaqaya:', universalBaqaya);
    console.log('=====================================');

    res.json({
      success: true,
      data: {
        openingBalance,
        universalBaqaya,
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
    const { 
      Transaction, Sale, StockEntry, Customer, Supplier, 
      Mazdoor, ExpenseType, TaxType, RawMaterialHead, Account, Item,
      MachineryItem, MillExpense
    } = req.models;
    const { dateFrom, dateTo } = req.query;
    const toDateStr = dateTo || new Date().toISOString().slice(0, 10);
    const fromDateStr = dateFrom || toDateStr;
    const fromDate = toUTCStartOfDay(fromDateStr);
    const toDate = toUTCEndOfDay(toDateStr);

    const activityMatch = { date: { $gte: fromDate, $lte: toDate } };

    // DEBUG: Log date range and check for 2026-04-09
    const isTargetDate = fromDateStr === '2026-04-09' || toDateStr === '2026-04-09';
    if (isTargetDate) {
      console.log('[DEBUG 2026-04-09] fromDate:', fromDate, 'toDate:', toDate);
      console.log('[DEBUG 2026-04-09] fromDateStr:', fromDateStr, 'toDateStr:', toDateStr);
    }

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
      Transaction.find(activityMatch)
        .populate('customerId', 'name')
        .populate('supplierId', 'name')
        .populate('mazdoorId', 'name')
        .populate('fromAccountId', 'name isMillKhata isDailyKhata')
        .populate('toAccountId', 'name isMillKhata isDailyKhata')
        .populate('expenseTypeId', 'name')
        .populate('taxTypeId', 'name')
        .populate('rawMaterialHeadId', 'name')
        .populate('machineryPurchaseId')
        .lean(),
      Sale.find(activityMatch).populate('customerId', 'name address phone').populate('items.itemId', 'name').populate('accountId', 'name').lean(),
      StockEntry.find(activityMatch).populate('supplierId', 'name address phone').populate('items.itemId', 'name').populate('accountId', 'name').lean(),
      Customer.find({}).lean(),
      Supplier.find({}).lean(),
      Mazdoor.find({}).lean(),
      ExpenseType.find({}).lean(),
      TaxType.find({}).lean(),
      RawMaterialHead.find({}).lean(),
      Account.find({}).lean(),
      Item.find({}).lean(),
      MachineryItem.find({}).lean(),
      MillExpense.find({}).lean()
    ]);

    // DEBUG: Log transactions found for 2026-04-09
    if (isTargetDate) {
      console.log('[DEBUG 2026-04-09] activeTrans count:', activeTrans.length);
      console.log('[DEBUG 2026-04-09] activeSales count:', activeSales.length);
      console.log('[DEBUG 2026-04-09] activePurchases count:', activePurchases.length);
      
      // Log customer transactions specifically
      const custTrans = activeTrans.filter(t => t.customerId);
      console.log('[DEBUG 2026-04-09] customer transactions:', custTrans.map(t => ({
        id: t._id.toString().slice(-6),
        type: t.type,
        amount: t.amount,
        customer: t.customerId?.name || t.customerId?._id?.toString().slice(-6),
        from: t.fromAccountId?.name,
        to: t.toAccountId?.name
      })));
    }

    // Helper: Calculation of individual entity's ID
    const getId = (ref) => ref?._id?.toString() || ref?.toString() || null;

    const activeCustomerIds = new Set([
      ...activeTrans.map(t => t.customerId?._id?.toString() || t.customerId?.toString()).filter(Boolean),
      ...activeSales.map(s => s.customerId?._id?.toString() || s.customerId?.toString()).filter(Boolean)
    ]);
    const activeSupplierIds = new Set([
      ...activeTrans.map(t => t.supplierId?._id?.toString() || t.supplierId?.toString()).filter(Boolean),
      ...activePurchases.map(p => p.supplierId?._id?.toString() || p.supplierId?.toString()).filter(Boolean)
    ]);
    const activeMazdoorIds = new Set([...activeTrans.map(t => getId(t.mazdoorId)).filter(Boolean)]);
    const activeExpenseTypeIds = new Set([...activeTrans.map(t => getId(t.expenseTypeId)).filter(Boolean)]);
    const activeTaxTypeIds = new Set([...activeTrans.map(t => getId(t.taxTypeId)).filter(Boolean)]);
    const activeRawMaterialHeadIds = new Set([...activeTrans.map(t => getId(t.rawMaterialHeadId)).filter(Boolean)]);
    const activeAccountIds = new Set([
      ...activeTrans.map(t => getId(t.fromAccountId)).filter(Boolean),
      ...activeTrans.map(t => getId(t.toAccountId)).filter(Boolean)
    ]);
    const activeMachineryItemIds = new Set([...activeTrans.map(t => getId(t.machineryPurchaseId?.machineryItemId) || getId(t.machineryItemId)).filter(Boolean)]);
    const activeMillExpenseIds = new Set(activeTrans.filter(t => t.category === 'mill_expense').map(t => t.category));
    const activeItemIds = new Set([
      ...activeSales.reduce((acc, s) => [...acc, ...(s.items || []).map(i => getId(i.itemId))], []),
      ...activePurchases.reduce((acc, p) => [...acc, ...(p.items || []).map(i => getId(i.itemId))], [])
    ].filter(Boolean));

    const consolidatedData = {
      customers: [], // Will contain unified ledgers for linked parties
      suppliers: [], // Will contain only non-linked suppliers
      mazdoors: [],
      expenses: [],
      taxes: [],
      rawMaterials: [],
      accounts: [],
      items: [],
      machinery: [],
      millExpenses: [],
      salesInvoices: activeSales,
      purchaseInvoices: activePurchases
    };

    // Helper: Calculation of individual entity's opening balance as of fromDate

    const getEntityOpeningBalance = async (type, id, openingVal = 0, linkedId = null) => {
      const matchBefore = { date: { $lt: fromDate } };
      let balance = Number(openingVal) || 0;

      if (type === 'customer') {
        // Unified balance if linked
        const orFilter = [{ customerId: id }];
        if (linkedId) orFilter.push({ supplierId: linkedId });
        
        // Fetch transactions with account data for proper transfer direction detection
        const [transData, sales, linkedPurchases] = await Promise.all([
          Transaction.find({ ...matchBefore, $or: orFilter })
            .populate('fromAccountId', 'name isMillKhata isDailyKhata')
            .populate('toAccountId', 'name isMillKhata isDailyKhata')
            .lean(),
          Sale.aggregate([{ $match: { ...matchBefore, customerId: id } }, { $group: { _id: null, sum: { $sum: '$totalAmount' } } }]),
          linkedId ? StockEntry.aggregate([{ $match: { ...matchBefore, supplierId: linkedId } }, { $group: { _id: null, sum: { $sum: '$amount' } } }]) : []
        ]);
        
        // Calculate with proper transfer direction
        let totalIn = 0, totalOut = 0;
        transData.forEach(t => {
          if (t.type === 'deposit' || t.type === 'income') {
            totalIn += t.amount;
          } else if (t.type === 'withdraw' || t.type === 'expense') {
            totalOut += t.amount;
          } else if (t.type === 'transfer') {
            const isFromMill = t.fromAccountId?.isMillKhata || t.fromAccountId?.isDailyKhata;
            const isToMill = t.toAccountId?.isMillKhata || t.toAccountId?.isDailyKhata;
            if (isFromMill && !isToMill) {
              // Mill -> Customer = Mill paid = Outflow
              totalOut += t.amount;
            } else if (!isFromMill && isToMill) {
              // Customer -> Mill = Customer paid = Inflow
              totalIn += t.amount;
            }
          }
        });
        
        const s = sales[0] || { sum: 0 };
        const lp = linkedPurchases[0] || { sum: 0 };
        
        // Final Balance = Base + Sales - Inflow + Outflow - Linked Purchases
        balance = balance + s.sum - totalIn + totalOut - lp.sum;

      } else if (type === 'supplier') {
        // Fetch transactions with account data for proper transfer direction detection
        const [transData, purch] = await Promise.all([
          Transaction.find({ ...matchBefore, supplierId: id })
            .populate('fromAccountId', 'name isMillKhata isDailyKhata')
            .populate('toAccountId', 'name isMillKhata isDailyKhata')
            .lean(),
          StockEntry.aggregate([{ $match: { ...matchBefore, supplierId: id } }, { $group: { _id: null, sum: { $sum: '$amount' } } }])
        ]);
        
        // Calculate with proper transfer direction
        let totalIn = 0, totalOut = 0;
        transData.forEach(t => {
          if (t.type === 'deposit' || t.type === 'income') {
            totalIn += t.amount;
          } else if (t.type === 'withdraw' || t.type === 'expense') {
            totalOut += t.amount;
          } else if (t.type === 'transfer') {
            const isFromMill = t.fromAccountId?.isMillKhata || t.fromAccountId?.isDailyKhata;
            const isToMill = t.toAccountId?.isMillKhata || t.toAccountId?.isDailyKhata;
            if (isFromMill && !isToMill) {
              // Mill -> Supplier = Mill paid = Outflow
              totalOut += t.amount;
            } else if (!isFromMill && isToMill) {
              // Supplier -> Mill = Supplier paid = Inflow
              totalIn += t.amount;
            }
          }
        });
        
        balance += totalOut - totalIn - (purch[0]?.sum || 0);

      } else if (type === 'mazdoor') {
        // Fetch transactions with account data for proper transfer direction detection
        const transData = await Transaction.find({ ...matchBefore, mazdoorId: id })
          .populate('fromAccountId', 'name isMillKhata isDailyKhata')
          .populate('toAccountId', 'name isMillKhata isDailyKhata')
          .lean();
        
        // Calculate with proper transfer direction
        let paid = 0, earned = 0;
        transData.forEach(t => {
          if (t.category === 'salary_accrual' || t.category === 'mazdoor_expense' || t.type === 'deposit' || t.type === 'income') {
            earned += t.amount;
          } else if (t.type === 'withdraw' || t.type === 'salary') {
            paid += t.amount;
          } else if (t.type === 'transfer') {
            const isFromMill = t.fromAccountId?.isMillKhata || t.fromAccountId?.isDailyKhata;
            const isToMill = t.toAccountId?.isMillKhata || t.toAccountId?.isDailyKhata;
            if (isFromMill && !isToMill) {
              // Mill -> Mazdoor = Mill paid wages = Paid
              paid += t.amount;
            } else if (!isFromMill && isToMill) {
              // Mazdoor -> Mill = Mazdoor paid/returned = Earned context
              earned += t.amount;
            }
          }
        });
        
        balance += earned - paid;

      } else if (type === 'expense') {
        const tx = await Transaction.aggregate([{ $match: { ...matchBefore, expenseTypeId: id } }, { $group: { _id: null, sum: { $sum: '$amount' } } }]);
        balance += (tx[0]?.sum || 0);
      } else if (type === 'tax') {
        const tx = await Transaction.aggregate([{ $match: { ...matchBefore, taxTypeId: id } }, { $group: { _id: null, sum: { $sum: '$amount' } } }]);
        balance += (tx[0]?.sum || 0);
      } else if (type === 'machinery') {
        const itemObjId = new mongoose.Types.ObjectId(id);
        const mpAgg = await Transaction.aggregate([
          { $match: { ...matchBefore, machineryPurchaseId: { $ne: null } } },
          { $lookup: { from: 'machinerypurchases', localField: 'machineryPurchaseId', foreignField: '_id', as: 'mp' } },
          { $unwind: '$mp' },
          { $match: { 'mp.machineryItemId': itemObjId } },
          { $group: { _id: null, sum: { $sum: '$amount' } } }
        ]);
        balance += (mpAgg[0]?.sum || 0);
      } else if (type === 'mill') {
        const tx = await Transaction.aggregate([{ $match: { ...matchBefore, category: 'mill_expense' } }, { $group: { _id: null, sum: { $sum: '$amount' } } }]);
        balance += (tx[0]?.sum || 0);
      } else if (type === 'raw') {
        // Fetch transactions with account data for proper transfer direction detection
        const transData = await Transaction.find({ ...matchBefore, rawMaterialHeadId: id })
          .populate('fromAccountId', 'name isMillKhata isDailyKhata')
          .populate('toAccountId', 'name isMillKhata isDailyKhata')
          .lean();
        
        // Calculate with proper transfer direction
        let sumIn = 0, sumOut = 0;
        transData.forEach(t => {
          if (t.type === 'deposit' || t.type === 'sale' || t.type === 'income') {
            sumIn += t.amount;
          } else if (t.type === 'withdraw' || t.type === 'salary' || t.type === 'tax' || t.type === 'expense' || t.type === 'purchase') {
            sumOut += t.amount;
          } else if (t.type === 'transfer') {
            const isFromMill = t.fromAccountId?.isMillKhata || t.fromAccountId?.isDailyKhata;
            const isToMill = t.toAccountId?.isMillKhata || t.toAccountId?.isDailyKhata;
            if (isFromMill && !isToMill) {
              // Mill -> External = Stock Out
              sumOut += t.amount;
            } else if (!isFromMill && isToMill) {
              // External -> Mill = Stock In
              sumIn += t.amount;
            }
          }
        });
        
        balance += sumIn - sumOut;
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
        // Items don't have opening balance - they track period turnover only
        // Opening balance stays as passed (0)
      }
      return balance;
    };

    // TRACK PROCESSED SUPPLIERS TO AVOID DUPLICATION
    const processedSupplierIds = new Set();

    // PROCESS CUSTOMERS (Now with Unified Logic)
    for (const cId of activeCustomerIds) {
      const party = allCustomers.find(c => c._id.toString() === cId);
      if (!party) continue;

      const linkedId = party.linkedSupplierId?.toString();
      const op = await getEntityOpeningBalance('customer', party._id, party.openingBalance, linkedId);
      
      const trans = activeTrans.filter(t => getId(t.customerId) === cId || (linkedId && getId(t.supplierId) === linkedId));
      const sales = activeSales.filter(s => getId(s.customerId) === cId);
      const linkedPurchases = linkedId ? activePurchases.filter(p => getId(p.supplierId) === linkedId) : [];
      
      const ledger = [];
      sales.forEach(s => ledger.push({ date: s.date, description: `Sale Invoice (Truck: ${s.truckNumber || '-'})`, debit: s.totalAmount, credit: 0, bags: (s.items || []).reduce((sum, it) => sum + (it.kattay || 0), 0) }));
      linkedPurchases.forEach(p => ledger.push({ date: p.date, description: `Purchase Invoice (Truck: ${p.truckNumber || '-'})`, debit: 0, credit: p.amount, bags: (p.items || []).reduce((sum, it) => sum + (it.kattay || 0), 0) }));
      
      trans.forEach(t => {
        // Customer Ledger Logic (Mill's Perspective on Customer Khata):
        // Deposit/Income = Customer paid mill = CREDIT (Jama - receivable reduced)
        // Withdraw/Expense = Mill paid customer = DEBIT (Naam - receivable increased)
        // Transfer: Direction matters!
        //   - FROM mill TO customer = Debit (mill paid)
        //   - FROM customer TO mill = Credit (customer paid)
        
        const isFromMill = t.fromAccountId?.isMillKhata || t.fromAccountId?.isDailyKhata;
        const isToMill = t.toAccountId?.isMillKhata || t.toAccountId?.isDailyKhata;
        
        let isCredit = t.type === 'deposit' || t.type === 'income';
        let isDebit = t.type === 'withdraw' || t.type === 'expense';
        
        // Transfer direction detection
        if (t.type === 'transfer') {
          if (isFromMill && !isToMill) {
            // Mill -> External (Customer) = Mill paid = Debit
            isDebit = true;
            isCredit = false;
          } else if (!isFromMill && isToMill) {
            // External (Customer) -> Mill = Customer paid = Credit
            isCredit = true;
            isDebit = false;
          } else if (!isFromMill && !isToMill && t.customerId) {
            // External -> External but linked to customer = SHOW IT
            // Customer received money (Bank -> Customer = Credit for customer)
            isCredit = true;
            isDebit = false;
          } else {
            // Internal transfer - skip
            return;
          }
        }
        
        const otherSide = isCredit ? (t.fromAccountId?.name || "Customer") : (t.toAccountId?.name || "Customer");
        const fallbackDesc = isCredit ? `Received from ${otherSide}` : `Paid to ${otherSide}`;
        
        ledger.push({
          date: t.date,
          description: t.note || fallbackDesc,
          debit: isDebit ? t.amount : 0,
          credit: isCredit ? t.amount : 0,
          bags: 0
        });
      });
      ledger.sort((a, b) => new Date(a.date) - new Date(b.date));

      consolidatedData.customers.push({ 
        name: party.name + (linkedId ? " (Cust/Sup)" : ""), 
        openingBalance: op, 
        ledger 
      });

      if (linkedId) processedSupplierIds.add(linkedId);
    }

    // PROCESS SUPPLIERS (Only those not already unified)
    for (const sId of activeSupplierIds) {
      if (processedSupplierIds.has(sId)) continue;

      const party = allSuppliers.find(s => s._id.toString() === sId);
      if (!party) continue;
      const op = await getEntityOpeningBalance('supplier', party._id, party.openingBalance);
      const trans = activeTrans.filter(t => getId(t.supplierId) === sId);
      const purchases = activePurchases.filter(p => getId(p.supplierId) === sId);

      const ledger = [];
      purchases.forEach(p => ledger.push({ date: p.date, description: `Purchase: ${p._id.toString().slice(-6)} (Truck: ${p.truckNumber || '-'})`, debit: 0, credit: p.amount, bags: (p.items || []).reduce((sum, it) => sum + (it.kattay || 0), 0) }));
      trans.forEach(t => {
        // Supplier Ledger Logic (Mill's Perspective on Supplier Khata):
        // Withdraw/Expense = Mill paid supplier = DEBIT (Naam - liability reduced)
        // Deposit/Income = Supplier paid/returned to mill = CREDIT (Jama - liability context)
        // Transfer: Direction matters!
        //   - FROM mill TO supplier = Debit (mill paid)
        //   - FROM supplier TO mill = Credit (supplier paid)
        
        const isFromMill = t.fromAccountId?.isMillKhata || t.fromAccountId?.isDailyKhata;
        const isToMill = t.toAccountId?.isMillKhata || t.toAccountId?.isDailyKhata;
        
        let isDebit = t.type === 'withdraw' || t.type === 'expense';
        let isCredit = t.type === 'deposit' || t.type === 'income';
        
        // Transfer direction detection
        if (t.type === 'transfer') {
          if (isFromMill && !isToMill) {
            // Mill -> External (Supplier) = Mill paid = Debit
            isDebit = true;
            isCredit = false;
          } else if (!isFromMill && isToMill) {
            // External (Supplier) -> Mill = Supplier paid = Credit
            isCredit = true;
            isDebit = false;
          } else {
            // Internal transfer - skip (shouldn't appear for supplier)
            return;
          }
        }
        
        const otherSide = isDebit ? (t.fromAccountId?.name || "Mill Account") : (t.toAccountId?.name || "Supplier");
        const fallbackDesc = isDebit ? `Payment via ${otherSide}` : `Received from ${otherSide}`;
        
        ledger.push({
          date: t.date,
          description: t.note || fallbackDesc,
          debit: isDebit ? t.amount : 0,
          credit: isCredit ? t.amount : 0,
          bags: 0
        });
      });
      ledger.sort((a, b) => new Date(a.date) - new Date(b.date));

      consolidatedData.suppliers.push({ name: party.name, openingBalance: op, ledger });
    }

    // PROCESS MAZDOORS
    for (const mId of activeMazdoorIds) {
      const party = allMazdoors.find(m => m._id.toString() === mId);
      if (!party) continue;
      const op = await getEntityOpeningBalance('mazdoor', party._id, 0);
      const trans = activeTrans.filter(t => getId(t.mazdoorId) === mId);
      const ledger = [];
      trans.forEach(t => {
        // Mazdoor Ledger Logic:
        // Earned: salary_accrual, mazdoor_expense, deposit, income = CREDIT (work done)
        // Paid: withdraw, salary = DEBIT (wages paid)
        // Transfer: Direction matters!
        //   - FROM mill TO mazdoor = Debit (mill paid wages)
        //   - FROM mazdoor TO mill = Credit (mazdoor paid/returned)
        
        const isFromMill = t.fromAccountId?.isMillKhata || t.fromAccountId?.isDailyKhata;
        const isToMill = t.toAccountId?.isMillKhata || t.toAccountId?.isDailyKhata;
        
        let isEarned = t.category === 'salary_accrual' || t.category === 'mazdoor_expense' || t.type === 'deposit' || t.type === 'income';
        let isPaid = t.type === 'withdraw' || t.type === 'salary';
        
        // Transfer direction detection
        if (t.type === 'transfer') {
          if (isFromMill && !isToMill) {
            // Mill -> Mazdoor = Mill paid wages = Debit (Paid)
            isPaid = true;
            isEarned = false;
          } else if (!isFromMill && isToMill) {
            // Mazdoor -> Mill = Mazdoor paid/returned = Credit (Earned context)
            isEarned = true;
            isPaid = false;
          } else {
            // Internal transfer - skip
            return;
          }
        }
        
        const otherSide = t.fromAccountId?.name || t.toAccountId?.name || "Mill Cash";
        const fallbackDesc = isEarned ? (t.type === 'income' ? 'Ledger Adjustment' : 'Work Earned/Brought In') : `Paid via ${otherSide}`;
        ledger.push({ 
          date: t.date, 
          description: t.note || fallbackDesc, 
          debit: isPaid ? t.amount : 0, 
          credit: isEarned ? t.amount : 0 
        });
      });
      ledger.sort((a, b) => new Date(a.date) - new Date(b.date));
      consolidatedData.mazdoors.push({ name: party.name, openingBalance: op, ledger });
    }

    // PROCESS EXPENSES
    for (const eId of activeExpenseTypeIds) {
      const party = allExpenseTypes.find(e => e._id.toString() === eId);
      if (!party) continue;
      const op = await getEntityOpeningBalance('expense', party._id, 0);
      const trans = activeTrans.filter(t => getId(t.expenseTypeId) === eId);
      const ledger = trans.map(t => ({ date: t.date, description: t.note || 'General Expense', debit: t.amount, credit: 0 }));
      ledger.sort((a, b) => new Date(a.date) - new Date(b.date));
      consolidatedData.expenses.push({ name: party.name, openingBalance: op, ledger });
    }

    // PROCESS RAW MATERIALS
    for (const rwId of activeRawMaterialHeadIds) {
      const party = allRawMaterialHeads.find(rw => rw._id.toString() === rwId);
      if (!party) continue;
      const op = await getEntityOpeningBalance('raw', party._id, 0);
      const trans = activeTrans.filter(t => getId(t.rawMaterialHeadId) === rwId);
      const ledger = trans.map(t => {
        // Raw Material Ledger Logic:
        // Stock In: deposit, sale, income = CREDIT (material received)
        // Stock Out: withdraw, salary, tax, expense, purchase = DEBIT (material used/sold)
        // Transfer: Direction matters!
        //   - FROM mill/external TO raw material = Credit (Stock In)
        //   - FROM raw material TO mill/external = Debit (Stock Out)
        
        const isFromMill = t.fromAccountId?.isMillKhata || t.fromAccountId?.isDailyKhata;
        const isToMill = t.toAccountId?.isMillKhata || t.toAccountId?.isDailyKhata;
        
        let isIn = t.type === 'deposit' || t.type === 'sale' || t.type === 'income';
        let isOut = t.type === 'withdraw' || t.type === 'salary' || t.type === 'tax' || t.type === 'expense' || t.type === 'purchase';
        
        // Transfer direction detection
        if (t.type === 'transfer') {
          if (isFromMill && !isToMill) {
            // Mill -> External = Stock Out = Debit
            isOut = true;
            isIn = false;
          } else if (!isFromMill && isToMill) {
            // External -> Mill = Stock In = Credit
            isIn = true;
            isOut = false;
          } else {
            // Internal transfer - skip
            return null;
          }
        }
        
        if (!isIn && !isOut) return null; // Skip if neither
        
        return { date: t.date, description: t.note || (isIn ? 'Stock In' : 'Stock Out'), debit: isOut ? t.amount : 0, credit: isIn ? t.amount : 0 };
      }).filter(Boolean); // Remove null entries
      ledger.sort((a, b) => new Date(a.date) - new Date(b.date));
      consolidatedData.rawMaterials.push({ name: party.name, openingBalance: op, ledger });
    }

    // PROCESS TAXES
    for (const tId of activeTaxTypeIds) {
      const party = allTaxTypes.find(t => t._id.toString() === tId);
      if (!party) continue;
      const op = await getEntityOpeningBalance('tax', party._id, 0);
      const trans = activeTrans.filter(t => getId(t.taxTypeId) === tId);
      const ledger = trans.map(t => ({ date: t.date, description: t.note || 'Tax Payment', debit: t.amount, credit: 0 }));
      ledger.sort((a, b) => new Date(a.date) - new Date(b.date));
      consolidatedData.taxes.push({ name: party.name, openingBalance: op, ledger });
    }

    // PROCESS MACHINERY
    for (const mId of activeMachineryItemIds) {
      const party = allMachineryItems.find(m => m._id.toString() === mId);
      if (!party) continue;
      const op = await getEntityOpeningBalance('machinery', party._id, 0);
      const trans = activeTrans.filter(t => getId(t.machineryPurchaseId?.machineryItemId) === mId || getId(t.machineryItemId) === mId);
      const ledger = trans.map(t => ({ date: t.date, description: t.note || 'Machinery/Asset Purchase', debit: t.amount, credit: 0 }));
      ledger.sort((a, b) => new Date(a.date) - new Date(b.date));
      consolidatedData.machinery.push({ name: party.name, openingBalance: op, ledger });
    }

    // PROCESS MILL EXPENSES (General category entries not tied to specific heads)
    if (activeMillExpenseIds.size > 0) {
      const op = await getEntityOpeningBalance('mill', 'mill_expense', 0);
      const trans = activeTrans.filter(t => t.category === 'mill_expense');
      const ledger = trans.map(t => ({ date: t.date, description: t.note || 'Mill General Expense', debit: t.amount, credit: 0 }));
      ledger.sort((a, b) => new Date(a.date) - new Date(b.date));
      consolidatedData.millExpenses.push({ name: "Mill General Activity", openingBalance: op, ledger });
    }

    // PROCESS ACCOUNTS
    for (const aId of activeAccountIds) {
      const party = allAccounts.find(a => a._id.toString() === aId);
      if (!party) continue;

      // Exclude internal/system accounts from this detailed diary
      const lowerName = (party.name || "").toLowerCase();
      if (lowerName.includes("mill khata") || lowerName.includes("daily khata")) continue;

      const op = await getEntityOpeningBalance('account', party._id, party.openingBalance);
      const trans = activeTrans.filter(t => getId(t.fromAccountId) === aId || getId(t.toAccountId) === aId);
      const ledger = trans.map(t => {
        // Account Ledger Logic (Asset Account Convention):
        // Money IN (toAccount matches) = DEBIT (asset increases)
        // Money OUT (fromAccount matches) = CREDIT (asset decreases)
        // This matches opening balance: balance = base + totalIn - totalOut
        // And display: runningBalance += (debit - credit) = += (incoming - outgoing)
        const isIn = getId(t.toAccountId) === aId;
        
        // Find the "other party" involved (Customer, Supplier, etc.)
        const participant = t.customerId?.name || t.supplierId?.name || t.mazdoorId?.name || (isIn ? t.fromAccountId?.name : t.toAccountId?.name);
        const fallbackDesc = isIn ? `From ${participant || 'Manual Deposit'}` : `To ${participant || 'General Expense'}`;

        return { 
          date: t.date, 
          description: (t.note || fallbackDesc) + ` [${t.type.toUpperCase()}]`, 
          debit: isIn ? t.amount : 0, 
          credit: isIn ? 0 : t.amount 
        };
      });
      ledger.sort((a, b) => new Date(a.date) - new Date(b.date));
      consolidatedData.accounts.push({ name: party.name, openingBalance: op, ledger });
    }

    // PROCESS ITEMS
    const itemObjIdSet = Array.from(activeItemIds).map(id => new mongoose.Types.ObjectId(id));
    for (const iId of activeItemIds) {
      const party = allItems.find(i => i._id.toString() === iId);
      if (!party) continue;
      // Items don't have opening balance - they just track turnover (sales/purchases)
      const op = 0;
      
      const itemSales = activeSales.filter(s => (s.items || []).some(item => getId(item.itemId) === iId));
      const itemPurchases = activePurchases.filter(p => (p.items || []).some(item => getId(item.itemId) === iId));

      const ledger = [];
      // No opening balance for items - only transactions
      
      itemSales.forEach(s => {
         // Get ALL matching lines for this item (same item can appear multiple times in one sale)
         const matches = (s.items || []).filter(it => getId(it.itemId) === iId);
         const custName = s.customerId?.name || allCustomers.find(c => c._id.toString() === getId(s.customerId))?.name || "Customer";
         matches.forEach((match, idx) => {
           ledger.push({ 
             date: s.date, 
             description: `Sale to ${custName} (Truck: ${s.truckNumber || '-'})${matches.length > 1 ? ` [Line ${idx + 1}]` : ''}`, 
             debit: match.totalAmount, 
             credit: 0, 
             status: 'sold', 
             bags: match.kattay || 0, 
             weight: match.quantity || 0 
           });
         });
      });
      itemPurchases.forEach(p => {
         // Get ALL matching lines for this item (same item can appear multiple times in one purchase)
         const matches = (p.items || []).filter(it => getId(it.itemId) === iId);
         const supName = p.supplierId?.name || allSuppliers.find(sup => sup._id.toString() === getId(p.supplierId))?.name || "Supplier";
         matches.forEach((match, idx) => {
           ledger.push({ 
             date: p.date, 
             description: `Purchase from ${supName} (Truck: ${p.truckNumber || '-'})${matches.length > 1 ? ` [Line ${idx + 1}]` : ''}`, 
             debit: 0, 
             credit: match.amount, 
             status: 'purchased', 
             bags: match.kattay || 0, 
             weight: match.quantity || match.receivedWeight || 0 
           });
         });
      });

      ledger.sort((a, b) => new Date(a.date) - new Date(b.date));
      consolidatedData.items.push({ name: party.name, openingBalance: op, ledger });
    }

    res.json({ success: true, data: consolidatedData });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
