import Sale from '../models/Sale.js';
import StockEntry from '../models/StockEntry.js';
import Item from '../models/Item.js';
import mongoose from 'mongoose';

async function getAvailableQuantity(itemId, excludeSaleId = null) {
  const itemObjId = new mongoose.Types.ObjectId(itemId);
  const inResult = await StockEntry.aggregate([
    { $match: { itemId: itemObjId } },
    { $group: { _id: null, total: { $sum: '$receivedWeight' } } },
  ]);
  const stockIn = inResult[0]?.total ?? 0;

  const saleMatch = { itemId: itemObjId };
  if (excludeSaleId) saleMatch._id = { $ne: new mongoose.Types.ObjectId(excludeSaleId) };
  const outResult = await Sale.aggregate([
    { $match: saleMatch },
    { $group: { _id: null, total: { $sum: '$quantity' } } },
  ]);
  const stockOut = outResult[0]?.total ?? 0;
  return Math.max(0, stockIn - stockOut);
}

export const getAvailable = async (req, res) => {
  const { itemId, excludeSaleId } = req.query;
  if (!itemId) {
    return res.status(400).json({ success: false, message: 'itemId required' });
  }
  const available = await getAvailableQuantity(itemId, excludeSaleId || null);
  res.json({ success: true, data: { available } });
};

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
    .populate({ path: 'itemId', select: 'name quality categoryId', populate: { path: 'categoryId', select: 'name' } })
    .populate('accountId', 'name')
    .sort({ date: -1 })
    .lean();

  const data = sales.map((s) => ({
    ...s,
    itemName: s.itemId?.name ?? '—',
    category: s.itemId?.categoryId?.name ?? '',
    quality: s.itemId?.quality ?? '',
  }));

  res.json({ success: true, data });
};

export const getById = async (req, res) => {
  const sale = await Sale.findById(req.params.id)
    .populate('customerId', 'name')
    .populate({ path: 'itemId', select: 'name quality categoryId', populate: { path: 'categoryId', select: 'name' } })
    .populate('accountId', 'name')
    .lean();
  if (!sale) {
    return res.status(404).json({ success: false, message: 'Sale not found' });
  }
  const data = {
    ...sale,
    itemName: sale.itemId?.name ?? '—',
    category: sale.itemId?.categoryId?.name ?? '',
    quality: sale.itemId?.quality ?? '',
  };
  res.json({ success: true, data });
};

export const create = async (req, res) => {
  const { date, customerId, itemId, quantity, rate, totalAmount, amountReceived, truckNumber, accountId, notes } = req.body;
  if (!customerId || !itemId || quantity == null) {
    return res.status(400).json({ success: false, message: 'customerId, itemId and quantity are required' });
  }
  const qty = Number(quantity) || 0;
  if (qty < 0) return res.status(400).json({ success: false, message: 'Quantity must be >= 0' });

  const available = await getAvailableQuantity(itemId);
  if (qty > available) {
    return res.status(400).json({ success: false, message: `Stock kam he. Is item ki available quantity: ${available}. Jo quantity bech rahe ho wo yahan se cut hoti he, zyada enter mat karo.` });
  }

  const r = Number(rate) || 0;
  const computedTotal = qty > 0 && r > 0 ? Math.round(qty * r) : (Number(totalAmount) || 0);

  const sale = await Sale.create({
    date: date ? new Date(date) : new Date(),
    customerId,
    itemId,
    quantity: qty,
    rate: r,
    totalAmount: computedTotal,
    truckNumber: (truckNumber || '').trim(),
    amountReceived: Number(amountReceived) || 0,
    accountId: accountId || null,
    notes: (notes || '').trim(),
  });

  const populated = await Sale.findById(sale._id)
    .populate('customerId', 'name')
    .populate({ path: 'itemId', select: 'name quality categoryId', populate: { path: 'categoryId', select: 'name' } })
    .populate('accountId', 'name')
    .lean();
  const row = { ...populated, itemName: populated.itemId?.name, category: populated.itemId?.categoryId?.name, quality: populated.itemId?.quality };
  res.status(201).json({ success: true, data: row });
};

export const update = async (req, res) => {
  const sale = await Sale.findById(req.params.id);
  if (!sale) {
    return res.status(404).json({ success: false, message: 'Sale not found' });
  }
  const { date, customerId, itemId, quantity, rate, totalAmount, amountReceived, truckNumber, accountId, notes } = req.body;
  const newItemId = itemId ? new mongoose.Types.ObjectId(itemId) : sale.itemId;
  const newQty = quantity != null ? Number(quantity) : sale.quantity;
  if (newQty < 0) return res.status(400).json({ success: false, message: 'Quantity must be >= 0' });

  const available = await getAvailableQuantity(newItemId, sale._id);
  if (newQty > available) {
    return res.status(400).json({ success: false, message: `Stock kam he. Is item ki available quantity: ${available}. Jo quantity bech rahe ho wo stock se cut hoti he.` });
  }

  const newRate = rate != null ? Number(rate) || 0 : sale.rate;
  const computedTotal = newQty > 0 && newRate > 0 ? Math.round(newQty * newRate) : (totalAmount != null ? Number(totalAmount) : sale.totalAmount);

  if (date != null) sale.date = new Date(date);
  if (customerId != null) sale.customerId = customerId;
  if (itemId != null) sale.itemId = newItemId;
  sale.quantity = newQty;
  if (rate != null) sale.rate = newRate;
  sale.totalAmount = computedTotal;
  if (truckNumber !== undefined) sale.truckNumber = (truckNumber || '').trim();
  if (amountReceived != null) sale.amountReceived = Number(amountReceived);
  if (accountId !== undefined) sale.accountId = accountId || null;
  if (notes !== undefined) sale.notes = (notes || '').trim();
  await sale.save();

  const populated = await Sale.findById(sale._id)
    .populate('customerId', 'name')
    .populate({ path: 'itemId', select: 'name quality categoryId', populate: { path: 'categoryId', select: 'name' } })
    .populate('accountId', 'name')
    .lean();
  const row = { ...populated, itemName: populated.itemId?.name, category: populated.itemId?.categoryId?.name, quality: populated.itemId?.quality };
  res.json({ success: true, data: row });
};

export const remove = async (req, res) => {
  const deleted = await Sale.findByIdAndDelete(req.params.id);
  if (!deleted) {
    return res.status(404).json({ success: false, message: 'Sale not found' });
  }
  res.json({ success: true, message: 'Sale deleted' });
};
