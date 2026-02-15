import StockEntry from '../models/StockEntry.js';
import Item from '../models/Item.js';
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
    .populate('itemId', 'name unit')
    .populate('supplierId', 'name')
    .populate('accountId', 'name')
    .sort({ date: -1 })
    .lean();
  res.json({ success: true, data: entries });
};

export const getById = async (req, res) => {
  const entry = await StockEntry.findById(req.params.id)
    .populate('itemId', 'name unit parts')
    .populate('supplierId', 'name')
    .populate('accountId', 'name')
    .lean();
  if (!entry) {
    return res.status(404).json({ success: false, message: 'Stock entry not found' });
  }
  res.json({ success: true, data: entry });
};

export const create = async (req, res) => {
  const { date, itemId, supplierId, receivedWeight, kattay, kgPerKata, amount, amountPaid, accountId, notes, outputs } = req.body;
  if (!itemId || !supplierId) {
    return res.status(400).json({ success: false, message: 'itemId and supplierId are required' });
  }
  const item = await Item.findById(itemId).lean();
  if (!item) return res.status(400).json({ success: false, message: 'Item not found' });

  const normalizedOutputs = (Array.isArray(outputs) ? outputs : [])
    .filter((o) => o && o.partId != null && Number(o.quantity) >= 0)
    .map((o) => ({
      partId: new mongoose.Types.ObjectId(o.partId),
      quantity: Number(o.quantity),
    }));

  const entry = await StockEntry.create({
    date: date ? new Date(date) : new Date(),
    itemId,
    supplierId,
    receivedWeight: receivedWeight != null ? Number(receivedWeight) : 0,
    kattay: Number(kattay) || 0,
    kgPerKata: Number(kgPerKata) || 0,
    amount: amount != null ? Number(amount) : 0,
    amountPaid: Number(amountPaid) || 0,
    accountId: accountId || null,
    notes: (notes || '').trim(),
    outputs: normalizedOutputs,
  });

  const populated = await StockEntry.findById(entry._id)
    .populate('itemId', 'name unit')
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
  const { date, itemId, supplierId, receivedWeight, kattay, kgPerKata, amount, amountPaid, accountId, notes, outputs } = req.body;
  if (date != null) entry.date = new Date(date);
  if (itemId != null) entry.itemId = itemId;
  if (supplierId != null) entry.supplierId = supplierId;
  if (receivedWeight != null) entry.receivedWeight = Number(receivedWeight);
  if (kattay != null) entry.kattay = Number(kattay) || 0;
  if (kgPerKata != null) entry.kgPerKata = Number(kgPerKata) || 0;
  if (amount != null) entry.amount = Number(amount);
  if (amountPaid != null) entry.amountPaid = Number(amountPaid);
  if (accountId !== undefined) entry.accountId = accountId || null;
  if (notes !== undefined) entry.notes = (notes || '').trim();
  if (Array.isArray(outputs)) {
    entry.outputs = outputs
      .filter((o) => o && o.partId != null && Number(o.quantity) >= 0)
      .map((o) => ({
        partId: new mongoose.Types.ObjectId(o.partId),
        quantity: Number(o.quantity),
      }));
  }
  await entry.save();
  const populated = await StockEntry.findById(entry._id)
    .populate('itemId', 'name unit')
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
