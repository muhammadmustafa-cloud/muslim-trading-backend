import Sale from '../models/Sale.js';
import StockEntry from '../models/StockEntry.js';
import Transaction from '../models/Transaction.js';
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
 * Returns unified daily cash memo: sales, stock entries, transactions (deposit/withdraw/transfer).
 * Query: dateFrom, dateTo (default today), accountId, customerId, supplierId, mazdoorId, itemId (khata).
 */
export const getDailyMemo = async (req, res) => {
  const { dateFrom, dateTo, accountId, customerId, supplierId, mazdoorId, itemId } = req.query;

  const today = new Date().toISOString().slice(0, 10);
  const from = dateFrom || today;
  const to = dateTo || today;
  const df = dateFilter(from, to);

  const salesMatch = { ...df };
  if (accountId) salesMatch.accountId = new mongoose.Types.ObjectId(accountId);
  if (customerId) salesMatch.customerId = new mongoose.Types.ObjectId(customerId);
  if (itemId) salesMatch.itemId = new mongoose.Types.ObjectId(itemId);

  const stockMatch = { ...df };
  if (accountId) stockMatch.accountId = new mongoose.Types.ObjectId(accountId);
  if (supplierId) stockMatch.supplierId = new mongoose.Types.ObjectId(supplierId);
  if (itemId) stockMatch.itemId = new mongoose.Types.ObjectId(itemId);

  const txMatch = { ...df };
  if (accountId) {
    txMatch.$or = [
      { fromAccountId: new mongoose.Types.ObjectId(accountId) },
      { toAccountId: new mongoose.Types.ObjectId(accountId) },
    ];
  }
  if (supplierId) txMatch.supplierId = new mongoose.Types.ObjectId(supplierId);
  if (mazdoorId) txMatch.mazdoorId = new mongoose.Types.ObjectId(mazdoorId);

  const [sales, stockEntries, transactions] = await Promise.all([
    Sale.find(salesMatch)
      .populate('customerId', 'name')
      .populate('accountId', 'name')
      .populate('itemId', 'name')
      .sort({ date: 1 })
      .lean(),
    StockEntry.find(stockMatch)
      .populate('supplierId', 'name')
      .populate('accountId', 'name')
      .populate('itemId', 'name')
      .sort({ date: 1 })
      .lean(),
    Transaction.find(txMatch)
      .populate('fromAccountId', 'name')
      .populate('toAccountId', 'name')
      .populate('supplierId', 'name')
      .populate('mazdoorId', 'name')
      .sort({ date: 1 })
      .lean(),
  ]);

  const rows = [];

  sales.forEach((s) => {
    rows.push({
      type: 'sale',
      date: s.date,
      description: `Sale — ${(s.customerId && s.customerId.name) || '—'}`,
      amount: Number(s.amountReceived) || 0,
      amountType: 'in',
      accountId: s.accountId?._id || s.accountId,
      accountName: s.accountId?.name || '—',
      customerId: s.customerId?._id || s.customerId,
      customerName: s.customerId?.name || '—',
      itemId: s.itemId?._id || s.itemId,
      itemName: s.itemId?.name || '—',
      referenceId: s._id,
      category: '',
      note: s.notes || '',
    });
  });

  stockEntries.forEach((e) => {
    rows.push({
      type: 'stock_entry',
      date: e.date,
      description: `Purchase — ${(e.supplierId && e.supplierId.name) || '—'}`,
      amount: Number(e.amountPaid) || Number(e.amount) || 0,
      amountType: 'out',
      accountId: e.accountId?._id || e.accountId,
      accountName: e.accountId?.name || '—',
      supplierId: e.supplierId?._id || e.supplierId,
      supplierName: e.supplierId?.name || '—',
      itemId: e.itemId?._id || e.itemId,
      itemName: e.itemId?.name || '—',
      referenceId: e._id,
      category: 'purchase',
      note: e.notes || '',
    });
  });

  transactions.forEach((t) => {
    const type = t.type;
    const category = t.category || '';
    const mazdoorName = t.mazdoorId?.name || '';
    const supplierName = t.supplierId?.name || '';
    let desc = type === 'deposit' ? 'Deposit' : type === 'withdraw' ? 'Withdraw' : 'Transfer';
    if (category) desc += ` — ${category}`;
    if (mazdoorName) desc += ` (${mazdoorName})`;
    if (supplierName) desc += ` (${supplierName})`;
    if (t.note) desc += ` — ${(t.note || '').slice(0, 40)}`;

    if (type === 'deposit') {
      rows.push({
        type: 'deposit',
        date: t.date,
        description: desc,
        amount: Number(t.amount) || 0,
        amountType: 'in',
        accountId: t.toAccountId?._id || t.toAccountId,
        accountName: t.toAccountId?.name || '—',
        toAccountId: null,
        toAccountName: null,
        mazdoorId: t.mazdoorId?._id || t.mazdoorId,
        mazdoorName: t.mazdoorId?.name || '—',
        supplierId: t.supplierId?._id || t.supplierId,
        supplierName: t.supplierId?.name || '—',
        referenceId: t._id,
        category,
        note: t.note || '',
      });
    } else if (type === 'withdraw') {
      rows.push({
        type: 'withdraw',
        date: t.date,
        description: desc,
        amount: Number(t.amount) || 0,
        amountType: 'out',
        accountId: t.fromAccountId?._id || t.fromAccountId,
        accountName: t.fromAccountId?.name || '—',
        toAccountId: null,
        toAccountName: null,
        mazdoorId: t.mazdoorId?._id || t.mazdoorId,
        mazdoorName: t.mazdoorId?.name || '—',
        supplierId: t.supplierId?._id || t.supplierId,
        supplierName: t.supplierId?.name || '—',
        referenceId: t._id,
        category,
        note: t.note || '',
      });
    } else {
      rows.push({
        type: 'transfer',
        date: t.date,
        description: `Transfer → ${t.toAccountId?.name || '—'}`,
        amount: Number(t.amount) || 0,
        amountType: 'out',
        accountId: t.fromAccountId?._id || t.fromAccountId,
        accountName: t.fromAccountId?.name || '—',
        toAccountId: t.toAccountId?._id || t.toAccountId,
        toAccountName: t.toAccountId?.name || '—',
        referenceId: t._id,
        category: '',
        note: t.note || '',
      });
      rows.push({
        type: 'transfer',
        date: t.date,
        description: `Transfer ← ${t.fromAccountId?.name || '—'}`,
        amount: Number(t.amount) || 0,
        amountType: 'in',
        accountId: t.toAccountId?._id || t.toAccountId,
        accountName: t.toAccountId?.name || '—',
        toAccountId: t.fromAccountId?._id || t.fromAccountId,
        toAccountName: t.fromAccountId?.name || '—',
        referenceId: t._id,
        category: '',
        note: t.note || '',
      });
    }
  });

  rows.sort((a, b) => new Date(a.date) - new Date(b.date));

  res.json({ success: true, data: rows });
};
