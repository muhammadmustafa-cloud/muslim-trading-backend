import Transaction from '../models/Transaction.js';
import Sale from '../models/Sale.js';
import StockEntry from '../models/StockEntry.js';
import TaxType from '../models/TaxType.js';
import ExpenseType from '../models/ExpenseType.js';
import mongoose from 'mongoose';

/**
 * Returns net flow for account: (sales + deposits in + transfers in) − (withdrawals + transfers out).
 * Full balance = openingBalance + getAccountBalance(accountId).
 */
async function getAccountBalance(accountId, asOfDate) {
  if (!accountId) return 0;
  const id = new mongoose.Types.ObjectId(accountId);
  
  // Professional Fix: Ensure asOfDate is interpreted as PKT End-of-Day
  let boundaryDate = null;
  if (asOfDate) {
    if (typeof asOfDate === 'string' && asOfDate.length === 10) {
      boundaryDate = new Date(`${asOfDate}T23:59:59.999+05:00`);
    } else {
      // If it's already a Date object, ensure it's treated accurately
      boundaryDate = new Date(asOfDate);
    }
  }
  
  const dateMatch = boundaryDate ? { date: { $lte: boundaryDate } } : {};

  const [depositIn, transferOutAsCredit, withdrawOut, transferInAsDebit] = await Promise.all([
    Transaction.aggregate([{ $match: { ...dateMatch, type: 'deposit', toAccountId: id } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
    Transaction.aggregate([{ $match: { ...dateMatch, type: 'transfer', fromAccountId: id } }, { $group: { _id: null, total: { $sum: '$amount' } } }]), // Source = Credit
    Transaction.aggregate([{ $match: { ...dateMatch, type: { $in: ['withdraw', 'salary', 'tax', 'expense'] }, fromAccountId: id } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
    Transaction.aggregate([{ $match: { ...dateMatch, type: 'transfer', toAccountId: id } }, { $group: { _id: null, total: { $sum: '$amount' } } }]), // Destination = Debit
  ]);
  const credits = (depositIn[0]?.total ?? 0) + (transferOutAsCredit[0]?.total ?? 0);
  const debits = (withdrawOut[0]?.total ?? 0) + (transferInAsDebit[0]?.total ?? 0);
  return credits - debits;
}

/**
 * Build date filter object for query.
 */
/**
 * Build date filter object for query.
 * Professional Fix: Forcing PKT (UTC+5) boundaries for all date strings.
 */
function buildDateFilter(dateFrom, dateTo) {
  const filter = {};
  if (dateFrom || dateTo) {
    filter.date = {};
    if (dateFrom) {
      // Force start of day PKT
      filter.date.$gte = new Date(`${dateFrom}T00:00:00+05:00`);
    }
    if (dateTo) {
      // Force end of day PKT
      filter.date.$lte = new Date(`${dateTo}T23:59:59.999+05:00`);
    }
  }
  return filter;
}

export const list = async (req, res) => {
  const { accountId, dateFrom, dateTo, mazdoorId, mazdoorOnly, unified, rawMaterialHeadId } = req.query;
  const includeSalesAndStock = unified === 'true' || unified === '1';

  if (includeSalesAndStock) {
    const id = accountId ? new mongoose.Types.ObjectId(accountId) : null;
    const dateF = buildDateFilter(dateFrom, dateTo);

    const [transactions, sales, stockEntries] = await Promise.all([
      (() => {
        const filter = { ...dateF, type: { $ne: 'accrual' } };
        if (id) filter.$or = [{ fromAccountId: id }, { toAccountId: id }];
        if (mazdoorId) filter.mazdoorId = new mongoose.Types.ObjectId(mazdoorId);
        else if (mazdoorOnly === 'true' || mazdoorOnly === true) filter.mazdoorId = { $ne: null };
        if (rawMaterialHeadId) filter.rawMaterialHeadId = new mongoose.Types.ObjectId(rawMaterialHeadId);
        return Transaction.find(filter)
          .populate('fromAccountId', 'name')
          .populate('toAccountId', 'name')
          .populate('supplierId', 'name')
          .populate('customerId', 'name')
          .populate('mazdoorId', 'name')
          .populate('stockEntryId')
          .populate('saleId')
          .populate('taxTypeId', 'name')
          .populate('expenseTypeId', 'name')
          .populate('rawMaterialHeadId', 'name')
          .sort({ date: -1 })
          .lean();
      })(),
      (() => {
        if (rawMaterialHeadId) return []; // Raw Material filtering is only for transactions
        const filter = { ...dateF, amountReceived: { $gt: 0 } };
        if (id) filter.accountId = id;
        return Sale.find(filter)
          .populate('customerId', 'name')
          .populate('accountId', 'name')
          .populate('items.itemId', 'name')
          .sort({ date: -1 })
          .lean();
      })(),
      (() => {
        if (rawMaterialHeadId) return []; // Raw Material filtering is only for transactions
        const filter = { ...dateF, $or: [{ amountPaid: { $gt: 0 } }, { amount: { $gt: 0 } }] };
        if (id) filter.accountId = id;
        return StockEntry.find(filter)
          .populate('supplierId', 'name')
          .populate('accountId', 'name')
          .populate('items.itemId', 'name')
          .sort({ date: -1 })
          .lean();
      })(),
    ]);

    const rows = [];
    transactions.forEach((t) => {
      rows.push({
        _id: t._id,
        date: t.date,
        type: t.type,
        fromAccountId: t.fromAccountId,
        toAccountId: t.toAccountId,
        amount: t.amount,
        category: t.category || '',
        note: t.note || '',
        source: 'transaction',
        referenceId: t._id,
        supplierName: t.supplierId?.name || '',
        customerName: t.customerId?.name || '',
        mazdoorName: t.mazdoorId?.name || '',
        stockEntryId: t.stockEntryId,
        saleId: t.saleId,
        machineryPurchaseId: t.machineryPurchaseId,
        taxTypeId: t.taxTypeId,
        taxTypeName: t.taxTypeId?.name || '',
        expenseTypeId: t.expenseTypeId,
        expenseTypeName: t.expenseTypeId?.name || '',
        rawMaterialHeadId: t.rawMaterialHeadId,
        rawMaterialHeadName: t.rawMaterialHeadId?.name || '',
      });
    });
    sales.forEach((s) => {
      const amt = Number(s.amountReceived) || 0;
      if (amt <= 0 || !s.accountId) return;
      rows.push({
        _id: `sale-${s._id}`,
        date: s.date,
        type: 'sale',
        fromAccountId: null,
        toAccountId: s.accountId,
        amount: amt,
        category: 'Sale',
        note: (s.notes || '').trim() || (s.customerId?.name ? `Customer: ${s.customerId.name}` : ''),
        source: 'sale',
        referenceId: s._id,
        customerName: s.customerId?.name,
        itemName: (s.items && s.items.length > 0) ? s.items.map(it => it.itemId?.name || 'Item').join(', ') : (s.itemId?.name || 'Item'),
      });
    });
    stockEntries.forEach((e) => {
      const amt = Number(e.amountPaid) || Number(e.amount) || 0;
      if (amt <= 0 || !e.accountId) return;
      rows.push({
        _id: `stock-${e._id}`,
        date: e.date,
        type: 'purchase',
        fromAccountId: e.accountId,
        toAccountId: null,
        amount: amt,
        category: 'Purchase',
        note: (e.notes || '').trim() || (e.supplierId?.name ? `Supplier: ${e.supplierId.name}` : ''),
        source: 'stock_entry',
        referenceId: e._id,
        supplierName: e.supplierId?.name,
        itemName: (e.items && e.items.length > 0) ? e.items.map(it => it.itemId?.name || 'Item').join(', ') : (e.itemId?.name || 'Item'),
      });
    });

    rows.sort((a, b) => new Date(b.date) - new Date(a.date));
    return res.json({ success: true, data: rows });
  }

  const filter = {};
  if (accountId) {
    const id = new mongoose.Types.ObjectId(accountId);
    filter.$or = [
      { fromAccountId: id },
      { toAccountId: id },
    ];
  }
  if (mazdoorId) {
    filter.mazdoorId = new mongoose.Types.ObjectId(mazdoorId);
  } else if (mazdoorOnly === 'true' || mazdoorOnly === true) {
    filter.mazdoorId = { $ne: null };
  }
  if (rawMaterialHeadId) {
    filter.rawMaterialHeadId = new mongoose.Types.ObjectId(rawMaterialHeadId);
  }
  filter.type = { $ne: 'accrual' };
  if (dateFrom || dateTo) {
    Object.assign(filter, buildDateFilter(dateFrom, dateTo));
  }

  const transactions = await Transaction.find(filter)
    .populate('fromAccountId', 'name')
    .populate('toAccountId', 'name')
    .populate('supplierId', 'name')
    .populate('customerId', 'name')
    .populate('mazdoorId', 'name')
    .populate('stockEntryId')
    .populate('saleId')
    .populate('taxTypeId', 'name')
    .populate('expenseTypeId', 'name')
    .populate('rawMaterialHeadId', 'name')
    .sort({ date: -1 })
    .lean();
  res.json({ success: true, data: transactions });
};

export const create = async (req, res) => {
  const { type, fromAccountId, toAccountId, amount, category, note, supplierId, customerId, mazdoorId, machineryPurchaseId, taxTypeId, expenseTypeId, rawMaterialHeadId, date, paymentMethod, chequeNumber, chequeDate } = req.body;
  if (!type || !['deposit', 'withdraw', 'transfer', 'accrual', 'salary', 'tax', 'expense'].includes(type)) {
    return res.status(400).json({ success: false, message: 'type must be deposit, withdraw, transfer, accrual, salary, tax, or expense' });
  }
  const amt = Number(amount);
  if (isNaN(amt) || amt <= 0) {
    return res.status(400).json({ success: false, message: 'amount must be a positive number' });
  }

  if (type === 'deposit') {
    if (!toAccountId) return res.status(400).json({ success: false, message: 'toAccountId required for deposit' });
  }
  if (type === 'withdraw' || type === 'salary' || type === 'tax' || type === 'expense') {
    if (!fromAccountId) return res.status(400).json({ success: false, message: `fromAccountId required for ${type}` });
    if (type === 'tax' && !taxTypeId) return res.status(400).json({ success: false, message: 'taxTypeId required for tax payment' });
    if (type === 'expense' && !expenseTypeId) return res.status(400).json({ success: false, message: 'expenseTypeId required for expense' });
  }
  if (type === 'salary') {
    if (!mazdoorId) return res.status(400).json({ success: false, message: 'mazdoorId required for salary' });
  }
  if (type === 'transfer') {
    if (!fromAccountId || !toAccountId) return res.status(400).json({ success: false, message: 'fromAccountId and toAccountId required for transfer' });
    if (fromAccountId === toAccountId) return res.status(400).json({ success: false, message: 'Cannot transfer to same account' });
  }
  if (type === 'accrual') {
    if (!mazdoorId) return res.status(400).json({ success: false, message: 'mazdoorId required for accrual' });
  }

  // Validate cheque fields
  if (paymentMethod === 'cheque' && !chequeNumber) {
    return res.status(400).json({ success: false, message: 'Cheque number zaroori hai jab payment method cheque ho.' });
  }

  const transaction = await Transaction.create({
    // Professional Fix: If a string date is provided, force it to PKT 00:00:00.
    // Otherwise, use current absolute time.
    date: date 
      ? (typeof date === 'string' && date.length === 10 ? new Date(`${date}T00:00:00+05:00`) : new Date(date)) 
      : new Date(),
    type,
    fromAccountId: fromAccountId || null,
    toAccountId: toAccountId || null,
    amount: amt,
    category: (category || '').trim(),
    note: (note || '').trim(),
    supplierId: supplierId || null,
    customerId: customerId || null,
    mazdoorId: mazdoorId || null,
    machineryPurchaseId: machineryPurchaseId || null,
    taxTypeId: taxTypeId || null,
    expenseTypeId: expenseTypeId || null,
    rawMaterialHeadId: rawMaterialHeadId || null,
    image: req.file ? req.file.path : null,
    paymentMethod: paymentMethod || 'cash',
    chequeNumber: (chequeNumber || '').trim(),
    chequeDate: chequeDate ? new Date(chequeDate) : null,
  });

  const populated = await Transaction.findById(transaction._id)
    .populate('fromAccountId', 'name')
    .populate('toAccountId', 'name')
    .populate('supplierId', 'name')
    .populate('customerId', 'name')
    .populate('mazdoorId', 'name')
    .populate('taxTypeId', 'name')
    .populate('expenseTypeId', 'name')
    .populate('rawMaterialHeadId', 'name')
    .lean();
  res.status(201).json({ success: true, data: populated });
};

export const getById = async (req, res) => {
  const transaction = await Transaction.findById(req.params.id)
    .populate('fromAccountId', 'name')
    .populate('toAccountId', 'name')
    .populate('supplierId', 'name')
    .populate('customerId', 'name')
    .populate('mazdoorId', 'name')
    .populate('taxTypeId', 'name')
    .populate('expenseTypeId', 'name')
    .populate('rawMaterialHeadId', 'name')
    .lean();
  if (!transaction) {
    return res.status(404).json({ success: false, message: 'Transaction not found' });
  }
  res.json({ success: true, data: transaction });
};

export { getAccountBalance };
