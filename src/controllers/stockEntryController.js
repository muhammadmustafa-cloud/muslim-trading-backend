import StockEntry from '../models/StockEntry.js';
import Item from '../models/Item.js';
import Transaction from '../models/Transaction.js';
import mongoose from 'mongoose';

export const list = async (req, res) => {
  const { dateFrom, dateTo, itemId, supplierId } = req.query;
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
  if (itemId) filter.itemId = new mongoose.Types.ObjectId(itemId);
  if (supplierId) filter.supplierId = new mongoose.Types.ObjectId(supplierId);

  const entries = await StockEntry.find(filter)
    .populate({ path: 'itemId', select: 'name quality categoryId', populate: { path: 'categoryId', select: 'name' } })
    .populate('supplierId', 'name')
    .populate('accountId', 'name')
    .sort({ date: -1 })
    .lean();
  res.json({ success: true, data: entries });
};

export const listPending = async (req, res) => {
  const { supplierId } = req.query;
  const filter = { paymentStatus: { $ne: 'paid' } };
  if (supplierId) filter.supplierId = new mongoose.Types.ObjectId(supplierId);

  const entries = await StockEntry.find(filter)
    .populate({ path: 'itemId', select: 'name quality categoryId', populate: { path: 'categoryId', select: 'name' } })
    .populate('supplierId', 'name')
    .sort({ dueDate: 1 })
    .lean();
  res.json({ success: true, data: entries });
};

export const getById = async (req, res) => {
  const entry = await StockEntry.findById(req.params.id)
    .populate({ path: 'itemId', select: 'name quality categoryId', populate: { path: 'categoryId', select: 'name' } })
    .populate('supplierId', 'name')
    .populate('accountId', 'name')
    .lean();
  if (!entry) {
    return res.status(404).json({ success: false, message: 'Stock entry not found' });
  }
  res.json({ success: true, data: entry });
};

export const create = async (req, res) => {
  const { date, itemId, supplierId, receivedWeight, kattay, kgPerKata, millWeight, supplierWeight, amount, amountPaid, dueDate, truckNumber, accountId, notes } = req.body;
  if (!itemId || !supplierId) {
    return res.status(400).json({ success: false, message: 'itemId and supplierId are required' });
  }
  const item = await Item.findById(itemId).lean();
  if (!item) return res.status(400).json({ success: false, message: 'Item not found' });

  const k = Number(kattay) || 0;
  const kg = Number(kgPerKata) || 0;
  const computedWeight = k > 0 && kg > 0 ? k * kg : (receivedWeight != null ? Number(receivedWeight) : 0);

  const amt = amount != null ? Number(amount) : 0;
  const paid = amountPaid != null ? Number(amountPaid) : 0;
  let status = 'pending';
  if (paid >= amt && amt > 0) status = 'paid';
  else if (paid > 0) status = 'partial';

  const entry = await StockEntry.create({
    date: date ? new Date(date) : new Date(),
    itemId,
    supplierId,
    receivedWeight: computedWeight,
    kattay: k,
    kgPerKata: kg,
    millWeight: millWeight != null ? Number(millWeight) : 0,
    supplierWeight: supplierWeight != null ? Number(supplierWeight) : 0,
    amount: amt,
    amountPaid: paid,
    dueDate: dueDate ? new Date(dueDate) : null,
    paymentStatus: status,
    truckNumber: (truckNumber || '').trim(),
    accountId: accountId || null,
    notes: (notes || '').trim(),
  });

  const populated = await StockEntry.findById(entry._id)
    .populate({ path: 'itemId', select: 'name quality categoryId', populate: { path: 'categoryId', select: 'name' } })
    .populate('supplierId', 'name')
    .populate('accountId', 'name')
    .lean();
  res.status(201).json({ success: true, data: populated });
};

export const update = async (req, res) => {
  const entry = await StockEntry.findById(req.params.id);
  if (!entry) {
    return res.status(404).json({ success: false, message: 'Stock entry not found' });
  }
  const { date, itemId, supplierId, receivedWeight, kattay, kgPerKata, millWeight, supplierWeight, amount, amountPaid, truckNumber, accountId, notes } = req.body;
  if (date != null) entry.date = new Date(date);
  if (itemId != null) entry.itemId = itemId;
  if (supplierId != null) entry.supplierId = supplierId;
  if (truckNumber !== undefined) entry.truckNumber = (truckNumber || '').trim();
  const k = kattay != null ? Number(kattay) || 0 : entry.kattay;
  const kg = kgPerKata != null ? Number(kgPerKata) || 0 : entry.kgPerKata;
  if (k > 0 && kg > 0) entry.receivedWeight = k * kg;
  else if (receivedWeight != null) entry.receivedWeight = Number(receivedWeight);
  if (kattay != null) entry.kattay = k;
  if (kgPerKata != null) entry.kgPerKata = kg;
  if (millWeight != null) entry.millWeight = Number(millWeight) || 0;
  if (supplierWeight != null) entry.supplierWeight = Number(supplierWeight) || 0;
  if (amount != null) entry.amount = Number(amount);
  if (amountPaid != null) entry.amountPaid = Number(amountPaid);
  if (req.body.dueDate !== undefined) entry.dueDate = req.body.dueDate ? new Date(req.body.dueDate) : null;

  // Recalculate status
  if (entry.amountPaid >= entry.amount && entry.amount > 0) entry.paymentStatus = 'paid';
  else if (entry.amountPaid > 0) entry.paymentStatus = 'partial';
  else entry.paymentStatus = 'pending';

  if (accountId !== undefined) entry.accountId = accountId || null;
  if (notes !== undefined) entry.notes = (notes || '').trim();
  await entry.save();
  const populated = await StockEntry.findById(entry._id)
    .populate({ path: 'itemId', select: 'name quality categoryId', populate: { path: 'categoryId', select: 'name' } })
    .populate('supplierId', 'name')
    .populate('accountId', 'name')
    .lean();
  res.json({ success: true, data: populated });
};

export const remove = async (req, res) => {
  const deleted = await StockEntry.findByIdAndDelete(req.params.id);
  if (!deleted) {
    return res.status(404).json({ success: false, message: 'Stock entry not found' });
  }
  res.json({ success: true, message: 'Stock entry deleted' });
};

export const payEntry = async (req, res) => {
  const { amount, accountId, date, note } = req.body;
  const entryId = req.params.id;

  if (!amount || amount <= 0) {
    return res.status(400).json({ success: false, message: 'Valid amount is required' });
  }
  if (!accountId) {
    return res.status(400).json({ success: false, message: 'AccountId is required' });
  }

  const entry = await StockEntry.findById(entryId);
  if (!entry) {
    return res.status(404).json({ success: false, message: 'Stock entry not found' });
  }

  const remaining = entry.amount - entry.amountPaid;
  if (amount > remaining) {
    return res.status(400).json({ success: false, message: `Payment amount (${amount}) exceeds remaining balance (${remaining})` });
  }

  // 1. Create Transaction
  const transaction = await Transaction.create({
    date: date ? new Date(date) : new Date(),
    type: 'withdraw',
    fromAccountId: accountId,
    amount: Number(amount),
    category: 'Supplier Payment',
    note: note || `Payment for Bill ${entry.truckNumber ? `(${entry.truckNumber})` : ''} on ${new Date(entry.date).toLocaleDateString()}`,
    supplierId: entry.supplierId,
    stockEntryId: entry._id
  });

  // 2. Update Stock Entry
  entry.amountPaid += Number(amount);

  if (entry.amountPaid >= entry.amount) entry.paymentStatus = 'paid';
  else if (entry.amountPaid > 0) entry.paymentStatus = 'partial';
  else entry.paymentStatus = 'pending';

  await entry.save();

  const populated = await StockEntry.findById(entry._id)
    .populate({ path: 'itemId', select: 'name quality categoryId', populate: { path: 'categoryId', select: 'name' } })
    .populate('supplierId', 'name')
    .populate('accountId', 'name')
    .lean();

  res.json({
    success: true,
    message: 'Payment recorded successfully',
    data: {
      stockEntry: populated,
      transaction
    }
  });
};
