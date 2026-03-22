import Item from '../models/Item.js';
import StockEntry from '../models/StockEntry.js';
import Sale from '../models/Sale.js';
import mongoose from 'mongoose';

const itemListSelect = 'name categoryId quality';
const itemListPopulate = { path: 'categoryId', select: 'name' };

export const list = async (req, res) => {
  const search = (req.query.search || '').trim();
  const categoryId = (req.query.categoryId || '').trim();
  const filter = {};
  if (search) filter.name = new RegExp(search, 'i');
  if (categoryId) filter.categoryId = new mongoose.Types.ObjectId(categoryId);
  const items = await Item.find(filter).populate(itemListPopulate).sort({ name: 1 }).lean();
  res.json({ success: true, data: items });
};

export const getById = async (req, res) => {
  const item = await Item.findById(req.params.id).populate(itemListPopulate).lean();
  if (!item) {
    return res.status(404).json({ success: false, message: 'Item not found' });
  }
  res.json({ success: true, data: item });
};

export const create = async (req, res) => {
  const { name, categoryId, quality } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, message: 'Name is required' });
  }
  const item = await Item.create({
    name: name.trim(),
    categoryId: categoryId || null,
    quality: (quality || '').trim(),
  });
  const populated = await Item.findById(item._id).populate(itemListPopulate).lean();
  res.status(201).json({ success: true, data: populated });
};

export const update = async (req, res) => {
  const { name, categoryId, quality } = req.body;
  const item = await Item.findById(req.params.id);
  if (!item) {
    return res.status(404).json({ success: false, message: 'Item not found' });
  }
  if (name !== undefined) {
    const trimmed = String(name).trim();
    if (!trimmed) return res.status(400).json({ success: false, message: 'Name is required' });
    item.name = trimmed;
  }
  if (categoryId !== undefined) item.categoryId = categoryId || null;
  if (quality !== undefined) item.quality = (quality || '').trim();
  await item.save();
  const populated = await Item.findById(item._id).populate(itemListPopulate).lean();
  res.json({ success: true, data: populated });
};


/**
 * Item khata (ledger): purchases (stock entries), sales, profit.
 * Query: dateFrom, dateTo (YYYY-MM-DD).
 */
export const getKhata = async (req, res) => {
  const item = await Item.findById(req.params.id).populate(itemListPopulate).lean();
  if (!item) {
    return res.status(404).json({ success: false, message: 'Item not found' });
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

  const purchaseMatch = { itemId };
  if (hasDateFilter) purchaseMatch.date = dateFilter;
  const saleMatch = { itemId };
  if (hasDateFilter) saleMatch.date = dateFilter;

  const [purchases, sales] = await Promise.all([
    StockEntry.find(purchaseMatch)
      .populate('supplierId', 'name')
      .populate('accountId', 'name')
      .sort({ date: -1 })
      .limit(500)
      .lean(),
    Sale.find(saleMatch)
      .populate('customerId', 'name')
      .populate('accountId', 'name')
      .sort({ date: -1 })
      .limit(500)
      .lean(),
  ]);

  const salesWithItem = sales.map((s) => ({
    ...s,
    itemName: item.name,
    category: item.categoryId?.name ?? '',
    quality: item.quality ?? '',
  }));

  const totalCost = purchases.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  const totalRevenue = sales.reduce((sum, s) => sum + (Number(s.totalAmount) || 0), 0);
  const totalBagsPurchased = purchases.reduce((sum, p) => sum + (Number(p.kattay) || 0), 0);
  const totalBagsSold = sales.reduce((sum, s) => sum + (Number(s.kattay) || 0), 0);
  const profit = totalRevenue - totalCost;

  res.json({
    success: true,
    data: {
      name: item.name,
      category: item.categoryId?.name ?? '',
      quality: item.quality ?? '',
      purchases,
      sales: salesWithItem,
      totalCost,
      totalRevenue,
      totalBagsPurchased,
      totalBagsSold,
      profit,
    },
  });
};
