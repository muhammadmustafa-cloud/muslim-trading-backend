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
export const getDailyMemo = async (req, res) => {
  const { dateFrom, dateTo } = req.query;

  const today = new Date().toISOString().slice(0, 10);
  const from = dateFrom || today;
  const to = dateTo || today;
  const df = dateFilter(from, to);

  // Transactions: skip auto-generated ones (linked to a sale or purchase)
  const txMatch = { ...df, stockEntryId: null, saleId: null };

  const [sales, stockEntries, transactions, millExpenses, mazdoorExpenses] = await Promise.all([
    Sale.find(df)
      .populate('customerId', 'name')
      .populate('accountId', 'name')
      .populate('itemId', 'name')
      .sort({ date: 1 })
      .lean(),
    StockEntry.find(df)
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
    MillExpense.find(df)
      .sort({ date: 1 })
      .lean(),
    MazdoorExpense.find(df)
      .populate('mazdoorId', 'name')
      .populate('mazdoorItemId', 'name')
      .populate('accountId', 'name')
      .sort({ date: 1 })
      .lean(),
  ]);

  const rows = [];

  // --- Sales (Credit / In) ---
  sales.forEach((s) => {
    const received = Number(s.amountReceived) || 0;
    if (received <= 0) return; // skip zero-amount sales
    rows.push({
      type: 'sale',
      source: 'sale',
      date: s.date,
      description: `Sale — ${s.customerId?.name || '—'} — ${s.itemId?.name || ''}`,
      amount: received,
      amountType: 'in',
      referenceId: s._id,
      note: s.notes || '',
    });
  });

  // --- Purchases / Stock Entries (Debit / Out) ---
  stockEntries.forEach((e) => {
    const paid = Number(e.amountPaid) || 0;
    if (paid <= 0) return;
    rows.push({
      type: 'purchase',
      source: 'purchase',
      date: e.date,
      description: `Purchase — ${e.supplierId?.name || '—'} — ${e.itemId?.name || ''}`,
      amount: paid,
      amountType: 'out',
      referenceId: e._id,
      note: e.notes || '',
    });
  });

  // --- Manual Transactions (Deposit / Withdraw / Transfer) ---
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
        source: 'transaction',
        date: t.date,
        description: desc,
        amount: Number(t.amount) || 0,
        amountType: 'in',
        referenceId: t._id,
        note: t.note || '',
      });
    } else if (type === 'withdraw') {
      rows.push({
        type: 'withdraw',
        source: 'transaction',
        date: t.date,
        description: desc,
        amount: Number(t.amount) || 0,
        amountType: 'out',
        referenceId: t._id,
        note: t.note || '',
      });
    } else {
      // Transfer creates two rows: out from source, in to destination
      rows.push({
        type: 'transfer',
        source: 'transaction',
        date: t.date,
        description: `Transfer → ${t.toAccountId?.name || '—'}`,
        amount: Number(t.amount) || 0,
        amountType: 'out',
        referenceId: t._id,
        note: t.note || '',
      });
      rows.push({
        type: 'transfer',
        source: 'transaction',
        date: t.date,
        description: `Transfer ← ${t.fromAccountId?.name || '—'}`,
        amount: Number(t.amount) || 0,
        amountType: 'in',
        referenceId: t._id,
        note: t.note || '',
      });
    }
  });

  // --- Mill Expenses (Debit / Out) ---
  millExpenses.forEach((m) => {
    const amt = Number(m.amount) || 0;
    if (amt <= 0) return;
    rows.push({
      type: 'mill_expense',
      source: 'mill_expense',
      date: m.date,
      description: `Mill Expense${m.category ? ` — ${m.category}` : ''}${m.note ? ` — ${m.note.slice(0, 30)}` : ''}`,
      amount: amt,
      amountType: 'out',
      referenceId: m._id,
      note: m.note || '',
    });
  });

  // --- Mazdoor Expenses (Debit / Out) ---
  mazdoorExpenses.forEach((me) => {
    const amt = Number(me.totalAmount) || 0;
    if (amt <= 0) return;
    rows.push({
      type: 'mazdoor_expense',
      source: 'mazdoor_expense',
      date: me.date,
      description: `Mazdoor — ${me.mazdoorId?.name || '—'}${me.mazdoorItemId?.name ? ` (${me.mazdoorItemId.name})` : ''}`,
      amount: amt,
      amountType: 'out',
      referenceId: me._id,
      note: '',
    });
  });

  // Sort all rows by date
  rows.sort((a, b) => new Date(a.date) - new Date(b.date));

  const totalIn = rows.filter((r) => r.amountType === 'in').reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const totalOut = rows.filter((r) => r.amountType === 'out').reduce((s, r) => s + (Number(r.amount) || 0), 0);

  res.json({
    success: true,
    data: rows,
    summary: {
      totalIn,
      totalOut,
      net: totalIn - totalOut,
    },
  });
};
