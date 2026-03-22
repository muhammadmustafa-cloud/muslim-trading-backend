import MachineryItem from '../models/MachineryItem.js';
import MachineryPurchase from '../models/MachineryPurchase.js';
import mongoose from 'mongoose';

const populateConfig = null;

export const list = async (req, res) => {
  const search = (req.query.search || '').trim();
  const filter = {};
  if (search) filter.name = new RegExp(search, 'i');
  const items = await MachineryItem.find(filter).sort({ name: 1 }).lean();
  
  // Calculate total cost for each item
  const itemsWithTotals = await Promise.all(items.map(async (item) => {
    const purchases = await MachineryPurchase.find({ machineryItemId: item._id });
    const totalCost = purchases.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    return { ...item, totalCost };
  }));

  res.json({ success: true, data: itemsWithTotals });
};

export const getById = async (req, res) => {
  const item = await MachineryItem.findById(req.params.id).lean();
  if (!item) {
    return res.status(404).json({ success: false, message: 'Machinery Item not found' });
  }
  res.json({ success: true, data: item });
};

export const create = async (req, res) => {
  const { name, quality, description } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, message: 'Name is required' });
  }
  const item = await MachineryItem.create({
    name: name.trim(),
    quality: (quality || '').trim(),
    description: (description || '').trim(),
  });
  const populated = await MachineryItem.findById(item._id).lean();
  res.status(201).json({ success: true, data: populated });
};

export const update = async (req, res) => {
  const { name, quality, description } = req.body;
  const item = await MachineryItem.findByIdAndUpdate(
    req.params.id,
    {
      name: name?.trim(),
      quality: quality?.trim(),
      description: description?.trim(),
    },
    { new: true, runValidators: true }
  ).lean();

  if (!item) {
    return res.status(404).json({ success: false, message: 'Machinery Item not found' });
  }
  res.json({ success: true, data: item });
};

export const deleteItem = async (req, res) => {
  const item = await MachineryItem.findByIdAndDelete(req.params.id);
  if (!item) {
    return res.status(404).json({ success: false, message: 'Machinery Item not found' });
  }
  res.json({ success: true, message: 'Machinery Item deleted' });
};

export const getKhata = async (req, res) => {
  const item = await MachineryItem.findById(req.params.id).lean();
  if (!item) {
    return res.status(404).json({ success: false, message: 'Machinery Item not found' });
  }
  const { dateFrom, dateTo } = req.query;
  const dateFilter = {};
  if (dateFrom) dateFilter.$gte = new Date(dateFrom);
  if (dateTo) {
    const d = new Date(dateTo);
    d.setHours(23, 59, 59, 999);
    dateFilter.$lte = d;
  }
  const hasDateFilter = Object.keys(dateFilter).length > 0;
  const itemId = new mongoose.Types.ObjectId(req.params.id);

  const purchaseMatch = { machineryItemId: itemId };
  if (hasDateFilter) purchaseMatch.date = dateFilter;

  const purchases = await MachineryPurchase.find(purchaseMatch)
    .populate('supplierId', 'name')
    .populate('accountId', 'name')
    .sort({ date: -1 })
    .lean();

  const totalCost = purchases.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

  res.json({
    success: true,
    data: {
      name: item.name,
      quality: item.quality ?? '',
      purchases,
      totalCost,
    },
  });
};
