import mongoose from 'mongoose';
import { getAccountBalance } from './transactionController.js';
import { getCurrentStockData } from './stockController.js';
import { toUTCStartOfDay, toUTCEndOfDay } from '../utils/dateUtils.js';
import { buildPartyLedger } from './partyLedgerController.js';
import { buildItemKhata } from './itemController.js';
import { buildDailyMemo } from './dailyMemoController.js';
import { buildMazdoorLedger } from './mazdoorController.js';

export const getAuditSummary = async (req, res) => {
  try {
    const { 
      Account, Customer, Supplier, Mazdoor, 
      MachineryPurchase, Transaction, Item, 
      RawMaterialHead, Sale, StockEntry 
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

    const allMillAccs = accounts.filter(a => a.isDailyKhata || a.isMillKhata || a.showMirrorInDailyMemo === false);
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
                { 
                  $and: [
                    { $in: ['$toAccIdStr', millAccIdStrings] }, // Standard Inflow: Money TO mill accounts
                    { $not: { $in: ['$type', ['salary', 'expense']] } } // Exclude salary/expense (matches Daily Memo logic)
                  ]
                },
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
    const openingBalance = baseOpeningBalance + (prevTransactions.length > 0 ? (prevTransactions[0].totalIn - prevTransactions[0].totalOut) : 0);

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
        isMillKhata: !!a.isMillKhata,
        showMirrorInDailyMemo: a.showMirrorInDailyMemo
      });

      if (!a.isDailyKhata && !a.isMillKhata && a.showMirrorInDailyMemo !== false) {
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

    // ----------------------------------------------------
    // WAREHOUSE REDIRECTION LOGIC (Audit Summary)
    // ----------------------------------------------------
    const warehouseItems = allItems.filter(i => i.linkedWarehouseCustomerId);
    const warehouseItemIds = warehouseItems.map(i => i._id.toString());
    const itemToCustomerMap = new Map(warehouseItems.map(i => [i._id.toString(), i.linkedWarehouseCustomerId.toString()]));

    // Build a list of "self-warehouse" sale exclusion keys: "itemId_customerId"
    // These are sales where the BUYER is the same as the item's linked warehouse customer.
    // In that case the credit already flows naturally via pSales — no redirection needed.
    // Format: "itemIdStr_warehouseCustIdStr" — we exclude these from redirection aggregations.
    const selfWarehousePairs = warehouseItems.map(i => `${i._id.toString()}_${i.linkedWarehouseCustomerId.toString()}`);

    // Helper: given an itemId string and a custId string, is this a self-warehouse sale?
    const isSelfWarehouseSale = (itemIdStr, custIdStr) =>
      selfWarehousePairs.includes(`${itemIdStr}_${custIdStr}`);

    // All-time redirected sales (for balance snapshot)
    // FIXED: Exclude self-warehouse sales (buyer IS the linked warehouse customer)
    const allTimeWarehouseSalesRaw = await Sale.aggregate([
      { $match: snapshotMatch },
      { $unwind: '$items' },
      {
        $addFields: {
          _itemIdStr:    { $toString: '$items.itemId' },
          _subItemIdStr: { $toString: { $ifNull: ['$items.subItemId', ''] } },
          _custIdStr:    { $toString: '$customerId' }
        }
      },
      {
        $match: {
          $or: [
            { _itemIdStr:    { $in: warehouseItemIds } },
            { _subItemIdStr: { $in: warehouseItemIds } }
          ]
        }
      }
    ]);

    const warehouseCreditsAllTime = new Map();
    allTimeWarehouseSalesRaw.forEach(row => {
      const itemIdStr    = row._itemIdStr;
      const subItemIdStr = row._subItemIdStr;
      const custIdStr    = row._custIdStr;
      const resolvedItemId = warehouseItemIds.includes(itemIdStr) ? itemIdStr
                           : warehouseItemIds.includes(subItemIdStr) ? subItemIdStr
                           : null;
      if (!resolvedItemId) return;
      // Skip self-warehouse sales — buyer is the warehouse customer itself
      if (isSelfWarehouseSale(resolvedItemId, custIdStr)) return;
      const warehouseCustId = itemToCustomerMap.get(resolvedItemId);
      if (!warehouseCustId) return;
      const amt = row.items?.totalAmount || 0;
      warehouseCreditsAllTime.set(warehouseCustId, (warehouseCreditsAllTime.get(warehouseCustId) || 0) + amt);
    });

    // Period redirected sales (for period In/Out)
    // FIXED: Exclude self-warehouse sales
    const periodWarehouseSalesRaw = await Sale.aggregate([
      { $match: activityMatch },
      { $unwind: '$items' },
      {
        $addFields: {
          _itemIdStr:    { $toString: '$items.itemId' },
          _subItemIdStr: { $toString: { $ifNull: ['$items.subItemId', ''] } },
          _custIdStr:    { $toString: '$customerId' }
        }
      },
      {
        $match: {
          $or: [
            { _itemIdStr:    { $in: warehouseItemIds } },
            { _subItemIdStr: { $in: warehouseItemIds } }
          ]
        }
      }
    ]);

    const warehouseCreditsPeriod = new Map();
    // Also track per-sale detail for virtual master log injection
    const periodWarehouseDetails = [];
    periodWarehouseSalesRaw.forEach(row => {
      const itemIdStr    = row._itemIdStr;
      const subItemIdStr = row._subItemIdStr;
      const custIdStr    = row._custIdStr;
      const resolvedItemId = warehouseItemIds.includes(itemIdStr) ? itemIdStr
                           : warehouseItemIds.includes(subItemIdStr) ? subItemIdStr
                           : null;
      if (!resolvedItemId) return;
      // Skip self-warehouse sales — buyer is the warehouse customer itself
      if (isSelfWarehouseSale(resolvedItemId, custIdStr)) return;
      const warehouseCustId = itemToCustomerMap.get(resolvedItemId);
      if (!warehouseCustId) return;
      const amt = row.items?.totalAmount || 0;
      warehouseCreditsPeriod.set(warehouseCustId, (warehouseCreditsPeriod.get(warehouseCustId) || 0) + amt);
      periodWarehouseDetails.push({ saleId: row._id, date: row.date, custIdStr, warehouseCustId, resolvedItemId, amt });
    });
    // ----------------------------------------------------

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
      const cIdStr = c._id.toString();
      const snapTrans = customerTransactions.find(b => b._id?.toString() === cIdStr) || { totalIn: 0, totalOut: 0 };
      const snapSales = customerSales.find(s => s._id?.toString() === cIdStr) || { total: 0 };
      const pTrans = periodCustomerTrans.find(b => b._id?.toString() === cIdStr) || { totalIn: 0, totalOut: 0 };
      const pSales = periodCustomerSales.find(s => s._id?.toString() === cIdStr) || { total: 0 };

      // Warehouse Credits
      const warehouseCrAllTime = warehouseCreditsAllTime.get(cIdStr) || 0;
      const warehouseCrPeriod = warehouseCreditsPeriod.get(cIdStr) || 0;

      // Balance = Base + Sales - (standardIn + warehouseIn) + standardOut
      const balance = (c.openingBalance || 0) + snapSales.total - (snapTrans.totalIn + warehouseCrAllTime) + snapTrans.totalOut;
      return { 
        _id: c._id, 
        name: c.name, 
        balance, 
        phone: c.phone || '',
        periodIn: pTrans.totalIn + warehouseCrPeriod, // RECEIVED in period (Standard + Warehouse Redirected)
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
      { $addFields: { calculatedAmount: { $sum: { $ifNull: ['$items.amount', []] } } } },
      { $group: { _id: '$supplierId', total: { $sum: '$calculatedAmount' } } }
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
      { $addFields: { calculatedAmount: { $sum: { $ifNull: ['$items.amount', []] } } } },
      { $group: { _id: '$supplierId', total: { $sum: '$calculatedAmount' } } }
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

    // Build a per-item map of self-warehouse sale amounts in this period.
    // These are sales where the buyer IS the linked warehouse customer (not redirected).
    const selfWarehouseSaleByItem = new Map();
    periodWarehouseSalesRaw.forEach(row => {
      const itemIdStr    = row._itemIdStr;
      const subItemIdStr = row._subItemIdStr;
      const custIdStr    = row._custIdStr;
      const resolvedItemId = warehouseItemIds.includes(itemIdStr) ? itemIdStr
                           : warehouseItemIds.includes(subItemIdStr) ? subItemIdStr
                           : null;
      if (!resolvedItemId) return;
      // Only count self-warehouse sales here
      if (!isSelfWarehouseSale(resolvedItemId, custIdStr)) return;
      const amt = row.items?.totalAmount || 0;
      selfWarehouseSaleByItem.set(resolvedItemId, (selfWarehouseSaleByItem.get(resolvedItemId) || 0) + amt);
    });

    const detailedItems = allItems.map(item => {
      const itemIdStr = item._id.toString();
      const p = itemPurchaseAgg.find(x => x._id?.toString() === itemIdStr) || { totalPurchase: 0 };
      const s = itemSaleAgg.find(x => x._id?.toString() === itemIdStr) || { totalSale: 0 };
      
      const isWarehouseItem = warehouseItemIds.includes(itemIdStr);

      let saleVolume = s.totalSale;
      if (isWarehouseItem) {
        // For warehouse items: suppress the REDIRECTED portion (3rd-party buyer sales).
        // But keep the SELF-WAREHOUSE portion (buyer is the warehouse customer itself).
        // saleVolume to show = only the self-warehouse sales (already captured in customer's periodOut)
        saleVolume = selfWarehouseSaleByItem.get(itemIdStr) || 0;
      }

      return {
        _id: item._id,
        name: item.name,
        purchaseVolume: p.totalPurchase,
        saleVolume
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

    // ----------------------------------------------------
    // INJECT VIRTUAL WAREHOUSE TRANSACTIONS INTO MASTER LOG
    // FIXED: Only inject for non-self-warehouse sales
    // ----------------------------------------------------
    if (warehouseCreditsPeriod.size > 0) {
      const periodWarehouseSales = await Sale.find(activityMatch)
        .populate('customerId', 'name')
        .populate('items.itemId', 'name')
        .lean();

      periodWarehouseSales.forEach(ws => {
        const wsCustIdStr = ws.customerId?._id?.toString() || ws.customerId?.toString();

        const matchingItems = ws.items?.filter(it => {
          const mId = it.itemId?._id?.toString() || it.itemId?.toString();
          const sId = it.subItemId?._id?.toString() || it.subItemId?.toString();
          const matchedId = warehouseItemIds.includes(mId) ? mId
                          : (sId && warehouseItemIds.includes(sId)) ? sId
                          : null;
          if (!matchedId) return false;
          // FIXED: Skip if buyer IS the warehouse customer for this item
          if (isSelfWarehouseSale(matchedId, wsCustIdStr)) return false;
          return true;
        }) || [];

        if (matchingItems.length === 0) return;

        const totalAmt = matchingItems.reduce((sum, it) => sum + (it.totalAmount || 0), 0);
        
        const firstMatchId = matchingItems[0].itemId?._id?.toString() || matchingItems[0].itemId?.toString();
        const warehouseCustId = itemToCustomerMap.get(firstMatchId);
        const warehouseCust = customers.find(c => c._id.toString() === warehouseCustId);

        periodTransactions.push({
          _id: `v-${ws._id}`,
          date: ws.date,
          type: 'deposit',
          amount: totalAmt,
          note: `Warehouse Stock Out to ${ws.customerId?.name || 'Party'}`,
          category: 'warehouse_redirection',
          customerId: warehouseCust,
          isVirtual: true
        });
      });
      periodTransactions.sort((a, b) => new Date(a.date) - new Date(b.date));
    }
    // ----------------------------------------------------

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
                { 
                  $and: [
                    { $in: ['$toAccIdStr', millAccIdStrings] }, // Standard Inflow: Money TO mill accounts
                    { $not: { $in: ['$type', ['salary', 'expense']] } } // Exclude salary/expense (matches Daily Memo logic)
                  ]
                },
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
    const universalBaqaya = baseOpeningBalance + (allTimeAgg.length > 0 ? (allTimeAgg[0].totalAllTimeIn - allTimeAgg[0].totalAllTimeOut) : 0);

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
      Mazdoor, Account, Item, ExpenseType, TaxType, RawMaterialHead, MachineryPurchase
    } = req.models;
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
      allAccounts,
      allItems,
      allExpenseTypes,
      allTaxTypes,
      allRawMaterialHeads,
      allMachineryItems
    ] = await Promise.all([
      Transaction.find(activityMatch).populate('fromAccountId', 'name isMillKhata isDailyKhata').populate('toAccountId', 'name isMillKhata isDailyKhata').lean(),
      Sale.find(activityMatch).select('customerId items.itemId').lean(),
      StockEntry.find(activityMatch).select('supplierId items.itemId').lean(),
      Customer.find({}).lean(),
      Supplier.find({}).lean(),
      Mazdoor.find({}).lean(),
      Account.find({}).lean(),
      Item.find({}).lean(),
      ExpenseType.find({}).lean(),
      TaxType.find({}).lean(),
      RawMaterialHead.find({}).lean(),
      MachineryPurchase.find({}).lean()
    ]);

    const getId = (ref) => ref?._id?.toString() || ref?.toString() || null;

    const activeCustomerIds = new Set([
      ...activeTrans.map(t => getId(t.customerId)).filter(Boolean),
      ...activeSales.map(s => getId(s.customerId)).filter(Boolean)
    ]);
    const activeSupplierIds = new Set([
      ...activeTrans.map(t => getId(t.supplierId)).filter(Boolean),
      ...activePurchases.map(p => getId(p.supplierId)).filter(Boolean)
    ]);
    const activeMazdoorIds = new Set([...activeTrans.map(t => getId(t.mazdoorId)).filter(Boolean)]);
    const activeAccountIds = new Set([
      ...activeTrans.map(t => getId(t.fromAccountId)).filter(Boolean),
      ...activeTrans.map(t => getId(t.toAccountId)).filter(Boolean)
    ]);
    const activeItemIds = new Set([
      ...activeSales.reduce((acc, s) => [...acc, ...(s.items || []).map(i => getId(i.itemId))], []),
      ...activePurchases.reduce((acc, p) => [...acc, ...(p.items || []).map(i => getId(i.itemId))], [])
    ].filter(Boolean));
    const activeExpenseTypeIds = new Set([...activeTrans.map(t => getId(t.expenseTypeId)).filter(Boolean)]);
    const activeTaxTypeIds = new Set([...activeTrans.map(t => getId(t.taxTypeId)).filter(Boolean)]);
    const activeRawMaterialHeadIds = new Set([...activeTrans.map(t => getId(t.rawMaterialHeadId)).filter(Boolean)]);
    const activeMachineryItemIds = new Set([
      ...activeTrans.map(t => getId(t.machineryPurchaseId?.machineryItemId)).filter(Boolean),
      ...activeTrans.map(t => getId(t.machineryItemId)).filter(Boolean)
    ]);
    const activeMillExpenseIds = new Set([...activeTrans.map(t => t.category === 'mill_expense' ? 'mill' : null).filter(Boolean)]);

    const consolidatedData = {
      customers: [],
      suppliers: [],
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

    // TRACK PROCESSED SUPPLIERS TO AVOID DUPLICATION
    const processedSupplierIds = new Set();

    const getEntityOpeningBalance = async (type, id, openingVal = 0) => {
      const matchBefore = { date: { $lt: fromDate } };
      let balance = Number(openingVal) || 0;
      if (type === 'expense') {
        const past = await Transaction.find({ ...matchBefore, expenseTypeId: new mongoose.Types.ObjectId(id) }).lean();
        balance += past.reduce((sum, t) => sum + (t.amount || 0), 0);
      } else if (type === 'tax') {
        const past = await Transaction.find({ ...matchBefore, taxTypeId: new mongoose.Types.ObjectId(id) }).lean();
        balance += past.reduce((sum, t) => sum + (t.amount || 0), 0);
      } else if (type === 'raw') {
        const past = await Transaction.find({ ...matchBefore, rawMaterialHeadId: new mongoose.Types.ObjectId(id) }).lean();
        // Skip detailed raw balance calc here to keep it simple, typically 0.
      } else if (type === 'machinery') {
        const past = await Transaction.find({ ...matchBefore, $or: [{ machineryItemId: new mongoose.Types.ObjectId(id) }, { machineryPurchaseId: new mongoose.Types.ObjectId(id) }] }).lean();
        balance += past.reduce((sum, t) => sum + (t.amount || 0), 0);
      } else if (type === 'mill') {
        const past = await Transaction.find({ ...matchBefore, category: 'mill_expense' }).lean();
        balance += past.reduce((sum, t) => sum + (t.amount || 0), 0);
      }
      return balance;
    };

    // PROCESS CUSTOMERS — using exact same buildPartyLedger used on the Party Ledger page
    for (const cId of activeCustomerIds) {
      const party = allCustomers.find(c => c._id.toString() === cId);
      if (!party) continue;
      const linkedId = party.linkedSupplierId?.toString();
      if (linkedId) processedSupplierIds.add(linkedId);

      try {
        const ledgerData = await buildPartyLedger(req.models, cId, 'customer', fromDateStr, toDateStr);
        consolidatedData.customers.push({ 
          name: ledgerData.name + (ledgerData.isLinked ? ' (Cust/Sup)' : ''), 
          openingBalance: ledgerData.summary?.openingBalance || 0,
          ledger: ledgerData.ledger,
          summary: ledgerData.summary
        });
      } catch(e) { console.warn('Customer ledger error', cId, e.message); }
    }

    // PROCESS SUPPLIERS (Only those not already unified with a customer)
    for (const sId of activeSupplierIds) {
      if (processedSupplierIds.has(sId)) continue;
      const party = allSuppliers.find(s => s._id.toString() === sId);
      if (!party) continue;

      try {
        const ledgerData = await buildPartyLedger(req.models, sId, 'supplier', fromDateStr, toDateStr);
        consolidatedData.suppliers.push({ 
          name: ledgerData.name, 
          openingBalance: ledgerData.summary?.openingBalance || 0, 
          ledger: ledgerData.ledger,
          summary: ledgerData.summary
        });
      } catch(e) { console.warn('Supplier ledger error', sId, e.message); }
    }

    // PROCESS MAZDOORS — using exact same buildMazdoorLedger used on Mazdoor History page
    for (const mId of activeMazdoorIds) {
      const party = allMazdoors.find(m => m._id.toString() === mId);
      if (!party) continue;

      try {
        const ledgerData = await buildMazdoorLedger(req.models, mId, fromDateStr, toDateStr);
        consolidatedData.mazdoors.push({ 
          name: ledgerData.name,
          monthlySalary: ledgerData.monthlySalary,
          openingBalance: 0, 
          ledger: ledgerData.transactions,
          summary: { balance: ledgerData.balance, totalEarned: ledgerData.totalEarned, totalPaid: ledgerData.totalPaid }
        });
      } catch(e) { console.warn('Mazdoor ledger error', mId, e.message); }
    }

    // PROCESS ACCOUNTS — using exact same buildDailyMemo used on Universal Ledger page
    for (const aId of activeAccountIds) {
      const party = allAccounts.find(a => a._id.toString() === aId);
      if (!party) continue;
      const lowerName = (party.name || '').toLowerCase();
      if (lowerName.includes('mill khata') || lowerName.includes('daily khata')) continue;

      try {
        const ledgerData = await buildDailyMemo(req.models, { dateFrom: fromDateStr, dateTo: toDateStr, accountId: aId });
        consolidatedData.accounts.push({ 
          name: party.name, 
          openingBalance: ledgerData.summary?.openingBalance || 0, 
          ledger: ledgerData.data,
          summary: ledgerData.summary
        });
      } catch(e) { console.warn('Account ledger error', aId, e.message); }
    }

    // PROCESS ITEMS — using exact same buildItemKhata used on Item Khata page
    for (const iId of activeItemIds) {
      const party = allItems.find(i => i._id.toString() === iId);
      if (!party) continue;

      try {
        const ledgerData = await buildItemKhata(req.models, iId, fromDateStr, toDateStr);
        // Item Khata returns purchases and sales arrays — unify them sorted by date for display
        const unifiedLedger = [
          ...(ledgerData.purchases || []).map(p => ({ ...p, ledgerType: 'purchase' })),
          ...(ledgerData.sales || []).map(s => ({ ...s, ledgerType: 'sale' }))
        ].sort((a, b) => new Date(a.date) - new Date(b.date));

        consolidatedData.items.push({ 
          name: ledgerData.name, 
          category: ledgerData.category,
          openingBalance: 0, 
          ledger: unifiedLedger,
          purchases: ledgerData.purchases,
          sales: ledgerData.sales,
          summary: { 
            profit: ledgerData.profit, 
            totalCost: ledgerData.totalCost,
            totalRevenue: ledgerData.totalRevenue,
            stockBalanceBags: ledgerData.stockBalanceBags, 
            stockBalanceMun: ledgerData.stockBalanceMun,
            totalBagsPurchased: ledgerData.totalBagsPurchased,
            totalBagsSold: ledgerData.totalBagsSold,
            totalMunPurchased: ledgerData.totalMunPurchased,
            totalMunSold: ledgerData.totalMunSold
          }
        });
      } catch(e) { console.warn('Item ledger error', iId, e.message); }
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
        const isFromMill = t.fromAccountId?.isMillKhata || t.fromAccountId?.isDailyKhata;
        const isToMill = t.toAccountId?.isMillKhata || t.toAccountId?.isDailyKhata;
        let isIn = t.type === 'deposit' || t.type === 'sale' || t.type === 'income';
        let isOut = t.type === 'withdraw' || t.type === 'salary' || t.type === 'tax' || t.type === 'expense' || t.type === 'purchase';
        if (t.type === 'transfer') {
          if (isFromMill && !isToMill) { isOut = true; isIn = false; }
          else if (!isFromMill && isToMill) { isIn = true; isOut = false; }
          else return null;
        }
        if (!isIn && !isOut) return null;
        return { date: t.date, description: t.note || (isIn ? 'Stock In' : 'Stock Out'), debit: isOut ? t.amount : 0, credit: isIn ? t.amount : 0 };
      }).filter(Boolean);
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

    // PROCESS MILL EXPENSES
    if (activeMillExpenseIds.size > 0) {
      const op = await getEntityOpeningBalance('mill', 'mill_expense', 0);
      const trans = activeTrans.filter(t => t.category === 'mill_expense');
      const ledger = trans.map(t => ({ date: t.date, description: t.note || 'Mill General Activity', debit: t.amount, credit: 0 }));
      ledger.sort((a, b) => new Date(a.date) - new Date(b.date));
      consolidatedData.millExpenses.push({ name: "Mill General Activity", openingBalance: op, ledger });
    }

    res.json({ success: true, data: consolidatedData });
  } catch (error) {
    console.error('Consolidated Ledger Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
