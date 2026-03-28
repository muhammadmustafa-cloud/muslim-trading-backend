import Sale from '../models/Sale.js';
import StockEntry from '../models/StockEntry.js';
import Transaction from '../models/Transaction.js';
import MillExpense from '../models/MillExpense.js';
import MazdoorExpense from '../models/MazdoorExpense.js';
import mongoose from 'mongoose';

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
  const { dateFrom, dateTo, accountId, customerId, supplierId, mazdoorId } = req.query;

  const todayStr = new Date().toISOString().slice(0, 10);
  const fromStr = dateFrom || todayStr;
  const toStr = dateTo || todayStr;

  const fromDate = new Date(fromStr);
  const toDate = new Date(toStr);
  toDate.setHours(23, 59, 59, 999);

  const prevMatch = { date: { $lt: fromDate }, type: { $ne: 'accrual' } };
  if (accountId) {
    const id = new mongoose.Types.ObjectId(accountId);
    prevMatch.$or = [{ fromAccountId: id }, { toAccountId: id }];
  }
  if (customerId) prevMatch.customerId = new mongoose.Types.ObjectId(customerId);
  if (supplierId) prevMatch.supplierId = new mongoose.Types.ObjectId(supplierId);
  if (mazdoorId) prevMatch.mazdoorId = new mongoose.Types.ObjectId(mazdoorId);

  // 1. Calculate Opening Balance (Net flow before fromDate)
  const prevTransactions = await Transaction.aggregate([
    { $match: prevMatch },
    {
      $group: {
        _id: null,
        totalIn: { $sum: { $cond: [{ $eq: ['$type', 'deposit'] }, '$amount', 0] } },
        totalOut: { $sum: { $cond: [{ $in: ['$type', ['withdraw', 'salary', 'tax', 'expense']] }, '$amount', 0] } },
      }
    }
  ]);

  const openingBalance = prevTransactions.length > 0 
    ? (prevTransactions[0].totalIn - prevTransactions[0].totalOut) 
    : 0;

  const currMatch = {
    date: { $gte: fromDate, $lte: toDate },
    type: { $ne: 'accrual' }
  };
  if (accountId) {
    const id = new mongoose.Types.ObjectId(accountId);
    currMatch.$or = [{ fromAccountId: id }, { toAccountId: id }];
  }
  if (customerId) currMatch.customerId = new mongoose.Types.ObjectId(customerId);
  if (supplierId) currMatch.supplierId = new mongoose.Types.ObjectId(supplierId);
  if (mazdoorId) currMatch.mazdoorId = new mongoose.Types.ObjectId(mazdoorId);

  // 2. Fetch ALL Transactions in range (Accruals excluded)
  const transactions = await Transaction.find(currMatch)
    .populate('fromAccountId', 'name')
    .populate('toAccountId', 'name')
    .populate('supplierId', 'name')
    .populate('customerId', 'name')
    .populate('mazdoorId', 'name')
    .populate({
      path: 'saleId',
      select: 'truckNumber items itemName',
      populate: { path: 'items.itemId', select: 'name' }
    })
    .populate({
      path: 'stockEntryId',
      select: 'truckNumber items',
      populate: { path: 'items.itemId', select: 'name' }
    })
    .populate({
      path: 'machineryPurchaseId',
      populate: { path: 'machineryItemId', select: 'name' }
    })
    .populate('taxTypeId', 'name')
    .populate('expenseTypeId', 'name')
    .sort({ date: 1, createdAt: 1 })
    .lean();
  
  const rows = [];

  transactions.forEach((t) => {
    const type = t.type;
    const category = t.category || '';
    
    // Party = only Customer or Supplier
    let partyName = '';
    if (t.customerId) partyName = t.customerId.name;
    else if (t.supplierId) partyName = t.supplierId.name;
    const hasParty = !!partyName;

    // Build richer description
    let desc = '';
    if (t.saleId) {
      const bill = t.saleId._id?.toString().slice(-6).toUpperCase() || '—';
      const itemNames = t.saleId.items?.length > 0 ? t.saleId.items.map(it => it.itemId?.name || 'Item').join(', ') : (t.saleId.itemName || 'Item');
      desc = `Sale — ${itemNames} (Bill: ${bill})`;
    } else if (t.stockEntryId) {
      const bill = t.stockEntryId._id?.toString().slice(-6).toUpperCase() || '—';
      const itemNames = t.stockEntryId.items?.length > 0 ? t.stockEntryId.items.map(it => it.itemId?.name || 'Item').join(', ') : 'Item';
      desc = `Purchase — ${itemNames} (Bill: ${bill})`;
    } else if (t.machineryPurchaseId) {
      desc = `Machinery — ${t.machineryPurchaseId.machineryItemId?.name || 'Part/Asset'}`;
    } else if (t.taxTypeId) {
      desc = `Tax: ${t.taxTypeId.name}`;
    } else if (t.expenseTypeId) {
      desc = `Expense: ${t.expenseTypeId.name}`;
    } else if (category === 'mill_expense') {
      const cleanNote = (t.note || '').replace(/^Mill:\s*/i, '').replace(/^Mill expense\s*—\s*/i, '');
      desc = `Mill Expense | ${cleanNote || 'General'}`;
    } else if (category === 'mazdoor_expense') {
      desc = `Mazdoor Expense | ${t.note || 'General'}`;
    } else {
      desc = t.note || category.replace('_', ' ');
    }

    // Append payment method info
    if (t.paymentMethod === 'cheque') {
      desc += ` | Cheque #${t.chequeNumber || '—'}`;
      if (t.chequeDate) desc += ` (${new Date(t.chequeDate).toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' })})`;
    } else if (t.paymentMethod === 'online') {
      desc += ' | Online';
    }

    if (type === 'deposit') {
      // Credit side: money came IN to account
      rows.push({
        type: category || 'deposit',
        date: t.date,
        name: partyName || '',
        description: desc,
        accountName: t.toAccountId?.name || 'Manual',
        amount: t.amount,
        amountType: 'in',
        referenceId: t._id,
      });
      // If party involved → also show Debit side (party gave money)
      if (hasParty) {
        rows.push({
          type: category || 'deposit',
          date: t.date,
          name: t.toAccountId?.name || 'Account',
          description: desc,
          accountName: partyName,
          amount: t.amount,
          amountType: 'out',
          referenceId: t._id,
        });
      }
    } else if (type === 'withdraw' || type === 'salary' || type === 'tax' || type === 'expense') {
      // Debit side: money went OUT from account
      rows.push({
        type: category || type,
        date: t.date,
        name: partyName || '',
        description: desc,
        accountName: t.fromAccountId?.name || 'Manual',
        amount: t.amount,
        amountType: 'out',
        referenceId: t._id,
      });
      // If party involved → also show Credit side (party received money)
      if (hasParty) {
        rows.push({
          type: category || type,
          date: t.date,
          name: t.fromAccountId?.name || 'Account',
          description: desc,
          accountName: partyName,
          amount: t.amount,
          amountType: 'in',
          referenceId: t._id,
        });
      }
    } else if (type === 'transfer') {
      rows.push({
        type: 'transfer_out',
        date: t.date,
        name: t.fromAccountId?.name || 'Account',
        description: `Transfer to ${t.toAccountId?.name || '—'}`,
        accountName: t.fromAccountId?.name || 'Manual',
        amount: t.amount,
        amountType: 'out',
        referenceId: t._id,
      });
      rows.push({
        type: 'transfer_in',
        date: t.date,
        name: t.toAccountId?.name || 'Account',
        description: `Transfer from ${t.fromAccountId?.name || '—'}`,
        accountName: t.toAccountId?.name || 'Manual',
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
