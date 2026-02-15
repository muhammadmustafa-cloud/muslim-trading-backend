import Sale from '../models/Sale.js';
import StockEntry from '../models/StockEntry.js';
import Item from '../models/Item.js';
import mongoose from 'mongoose';

async function getAvailableQuantity(partId, excludeSaleId = null) {
  const partObjId = new mongoose.Types.ObjectId(partId);
  const inResult = await StockEntry.aggregate([
    { $unwind: '$outputs' },
    { $match: { 'outputs.partId': partObjId } },
    { $group: { _id: null, total: { $sum: '$outputs.quantity' } } },
  ]);
  const stockIn = inResult[0]?.total ?? 0;

  const saleMatch = { partId: partObjId };
  if (excludeSaleId) saleMatch._id = { $ne: new mongoose.Types.ObjectId(excludeSaleId) };
  const outResult = await Sale.aggregate([
    { $match: saleMatch },
    { $group: { _id: null, total: { $sum: '$quantity' } } },
  ]);
  const stockOut = outResult[0]?.total ?? 0;
  return stockIn - stockOut;
}

export const list = async (req, res) => {
  const { dateFrom, dateTo, customerId, itemId } = req.query;
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
  if (customerId) filter.customerId = new mongoose.Types.ObjectId(customerId);
  if (itemId) filter.itemId = new mongoose.Types.ObjectId(itemId);

  const sales = await Sale.find(filter)
    .populate('customerId', 'name')
    .populate('itemId', 'name unit')
    .populate('accountId', 'name')
    .sort({ date: -1 })
    .lean();

  const items = await Item.find({}).lean();
  const itemMap = new Map(items.map((i) => [i._id.toString(), i]));

  const data = sales.map((s) => {
    const item = itemMap.get((s.itemId?._id || s.itemId).toString());
    const part = (item?.parts || []).find((p) => p._id.toString() === (s.partId || s.partId?.toString?.()));
    return {
      ...s,
      partName: part?.partName || '—',
      partUnit: part?.unit || 'kg',
    };
  });

  res.json({ success: true, data });
};

export const getById = async (req, res) => {
  const sale = await Sale.findById(req.params.id)
    .populate('customerId', 'name')
    .populate('itemId', 'name unit parts')
    .populate('accountId', 'name')
    .lean();
  if (!sale) {
    return res.status(404).json({ success: false, message: 'Sale not found' });
  }
  const item = sale.itemId;
  const part = (item?.parts || []).find((p) => p._id.toString() === (sale.partId || sale.partId?.toString?.()));
  res.json({
    success: true,
    data: { ...sale, partName: part?.partName, partUnit: part?.unit || 'kg' },
  });
};

export const create = async (req, res) => {
  const { date, customerId, itemId, partId, quantity, rate, totalAmount, amountReceived, accountId, notes } = req.body;
  if (!customerId || !itemId || !partId || quantity == null) {
    return res.status(400).json({ success: false, message: 'customerId, itemId, partId and quantity are required' });
  }
  const qty = Number(quantity) || 0;
  if (qty < 0) return res.status(400).json({ success: false, message: 'Quantity must be >= 0' });

  const available = await getAvailableQuantity(partId);
  if (qty > available) {
    return res.status(400).json({ success: false, message: `Insufficient stock. Available: ${available}` });
  }

  const sale = await Sale.create({
    date: date ? new Date(date) : new Date(),
    customerId,
    itemId,
    partId: new mongoose.Types.ObjectId(partId),
    quantity: qty,
    rate: Number(rate) || 0,
    totalAmount: Number(totalAmount) || 0,
    amountReceived: Number(amountReceived) || 0,
    accountId: accountId || null,
    notes: (notes || '').trim(),
  });

  const populated = await Sale.findById(sale._id)
    .populate('customerId', 'name')
    .populate('itemId', 'name unit')
    .populate('accountId', 'name')
    .lean();
  res.status(201).json({ success: true, data: populated });
};

export const update = async (req, res) => {
  const sale = await Sale.findById(req.params.id);
  if (!sale) {
    return res.status(404).json({ success: false, message: 'Sale not found' });
  }
  const { date, customerId, itemId, partId, quantity, rate, totalAmount, amountReceived, accountId, notes } = req.body;
  const newPartId = partId ? new mongoose.Types.ObjectId(partId) : sale.partId;
  const newQty = quantity != null ? Number(quantity) : sale.quantity;
  if (newQty < 0) return res.status(400).json({ success: false, message: 'Quantity must be >= 0' });

  const available = await getAvailableQuantity(newPartId, sale._id);
  if (newQty > available) {
    return res.status(400).json({ success: false, message: `Insufficient stock. Available: ${available}` });
  }

  if (date != null) sale.date = new Date(date);
  if (customerId != null) sale.customerId = customerId;
  if (itemId != null) sale.itemId = itemId;
  if (partId != null) sale.partId = newPartId;
  sale.quantity = newQty;
  if (rate != null) sale.rate = Number(rate);
  if (totalAmount != null) sale.totalAmount = Number(totalAmount);
  if (amountReceived != null) sale.amountReceived = Number(amountReceived);
  if (accountId !== undefined) sale.accountId = accountId || null;
  if (notes !== undefined) sale.notes = (notes || '').trim();
  await sale.save();

  const populated = await Sale.findById(sale._id)
    .populate('customerId', 'name')
    .populate('itemId', 'name unit')
    .populate('accountId', 'name')
    .lean();
  res.json({ success: true, data: populated });
};

export const remove = async (req, res) => {
  const deleted = await Sale.findByIdAndDelete(req.params.id);
  if (!deleted) {
    return res.status(404).json({ success: false, message: 'Sale not found' });
  }
  res.json({ success: true, message: 'Sale deleted' });
};
