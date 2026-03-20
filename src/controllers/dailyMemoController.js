import Sale from '../models/Sale.js';
import StockEntry from '../models/StockEntry.js';
import Transaction from '../models/Transaction.js';
import MillExpense from '../models/MillExpense.js';
import MazdoorExpense from '../models/MazdoorExpense.js';

/**
 * Build date filter for a single day or range.
 */
function dateFilter(dateFrom, dateTo) {
  const filter = {};
  if (dateFrom || dateTo) {
    filter.date = {};
    if (dateFrom) filter.date.$gte = new Date(dateFrom);
    if (dateTo) {
      const d = new Date(dateTo);
      d.setHours(23, 59, 59, 999);
      filter.date.$lte = d;
    }
  }
  return filter;
}

/**
 * GET /api/daily-memo
 * Universal Daily Ledger — aggregates ALL financial activity across the system.
 * Sources: Sales, Purchases (StockEntry), Transactions, Mill Expenses, Mazdoor Expenses.
 * Query: dateFrom, dateTo (default today).
 * Skips auto-generated transactions (those linked to stockEntryId or saleId) to avoid double-counting.
 */
/**
 * GET /api/daily-memo
 * Universal Daily Ledger — now strictly follows CASH FLOW using the Transaction model.
 */
export const getDailyMemo = async (req, res) => {
  const { dateFrom, dateTo } = req.query;

  const todayStr = new Date().toISOString().slice(0, 10);
  const fromStr = dateFrom || todayStr;
  const toStr = dateTo || todayStr;

  const fromDate = new Date(fromStr);
  const toDate = new Date(toStr);
  toDate.setHours(23, 59, 59, 999);

  // 1. Calculate Opening Balance (Net flow before fromDate)
  // Logic: In (Deposit) - Out (Withdraw) for all time until fromDate
  const prevTransactions = await Transaction.aggregate([
    { $match: { date: { $lt: fromDate }, category: { $ne: 'mill_expense' } } },
    {
      $group: {
        _id: null,
        totalIn: { $sum: { $cond: [{ $eq: ['$type', 'deposit'] }, '$amount', 0] } },
        totalOut: { $sum: { $cond: [{ $eq: ['$type', 'withdraw'] }, '$amount', 0] } },
      }
    }
  ]);

  const openingBalance = prevTransactions.length > 0 
    ? (prevTransactions[0].totalIn - prevTransactions[0].totalOut) 
    : 0;

  // 2. Fetch Transactions in the range (excluding mill expenses)
  const transactions = await Transaction.find({ 
    date: { $gte: fromDate, $lte: toDate },
    category: { $ne: 'mill_expense' } 
  })
    .populate('fromAccountId', 'name')
    .populate('toAccountId', 'name')
    .populate('supplierId', 'name')
    .populate('customerId', 'name')
    .populate('mazdoorId', 'name')
    .populate({
      path: 'saleId',
      select: 'truckNumber itemId itemName',
      populate: { path: 'itemId', select: 'name' }
    })
    .populate({
      path: 'stockEntryId',
      select: 'truckNumber itemId',
      populate: { path: 'itemId', select: 'name' }
    })
    .sort({ date: 1, createdAt: 1 })
    .lean();

  const rows = [];

  transactions.forEach((t) => {
    const type = t.type;
    const category = t.category || '';
    
    // Build descriptive name/header
    let rowName = '';
    if (t.customerId) rowName = t.customerId.name;
    else if (t.supplierId) rowName = t.supplierId.name;
    else if (t.mazdoorId) rowName = t.mazdoorId.name;
    else if (t.fromAccountId && type === 'withdraw') rowName = t.fromAccountId.name;
    else if (t.toAccountId && type === 'deposit') rowName = t.toAccountId.name;
    else rowName = category.replace('_', ' ').toUpperCase();

    // Build richer description
    let desc = '';
    if (t.saleId) {
      desc = `Sale — ${t.saleId.itemId?.name || t.saleId.itemName || 'Item'}`;
      if (t.saleId.truckNumber) desc += ` (${t.saleId.truckNumber})`;
    } else if (t.stockEntryId) {
      desc = `Purchase — ${t.stockEntryId.itemId?.name || 'Item'}`;
      if (t.stockEntryId.truckNumber) desc += ` (${t.stockEntryId.truckNumber})`;
    } else {
      desc = t.note || category.replace('_', ' ');
    }

    if (type === 'deposit') {
      rows.push({
        type: category || 'deposit',
        date: t.date,
        name: rowName,
        description: desc,
        amount: t.amount,
        amountType: 'in',
        referenceId: t._id,
      });
    } else if (type === 'withdraw') {
      rows.push({
        type: category || 'withdraw',
        date: t.date,
        name: rowName,
        description: desc,
        amount: t.amount,
        amountType: 'out',
        referenceId: t._id,
      });
    } else if (type === 'transfer') {
      // For Daily Memo, we show the cash movement
      rows.push({
        type: 'transfer',
        date: t.date,
        name: t.fromAccountId?.name || 'Account',
        description: `Transfer to ${t.toAccountId?.name || '—'}`,
        amount: t.amount,
        amountType: 'out',
        referenceId: t._id,
      });
      rows.push({
        type: 'transfer',
        date: t.date,
        name: t.toAccountId?.name || 'Account',
        description: `Transfer from ${t.fromAccountId?.name || '—'}`,
        amount: t.amount,
        amountType: 'in',
        referenceId: t._id,
      });
    }
  });

  const totalIn = rows.filter(r => r.amountType === 'in').reduce((s, r) => s + r.amount, 0);
  const totalOut = rows.filter(r => r.amountType === 'out').reduce((s, r) => s + r.amount, 0);

  res.json({
    success: true,
    data: rows,
    summary: {
      openingBalance,
      totalIn,
      totalOut,
      net: totalIn - totalOut,
      closingBalance: openingBalance + totalIn - totalOut
    },
  });
};
