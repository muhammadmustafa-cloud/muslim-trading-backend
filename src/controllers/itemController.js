import Item from '../models/Item.js';
import StockEntry from '../models/StockEntry.js';
import Sale from '../models/Sale.js';
import mongoose from 'mongoose';

export const list = async (req, res) => {
  const search = (req.query.search || '').trim();
  const filter = search ? { name: new RegExp(search, 'i') } : {};
  const items = await Item.find(filter).sort({ name: 1 }).lean();
  res.json({ success: true, data: items });
};

export const getById = async (req, res) => {
  const item = await Item.findById(req.params.id).lean();
  if (!item) {
    return res.status(404).json({ success: false, message: 'Item not found' });
  }
  res.json({ success: true, data: item });
};

export const create = async (req, res) => {
  const { name, unit, parts } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, message: 'Name is required' });
  }
  const normalizedParts = (Array.isArray(parts) ? parts : [])
    .filter((p) => p && (p.partName || '').trim())
    .map((p) => ({
      partName: (p.partName || '').trim(),
      unit: (p.unit || 'kg').trim() || 'kg',
    }));
  const item = await Item.create({
    name: name.trim(),
    unit: (unit || 'kg').trim() || 'kg',
    parts: normalizedParts,
  });
  res.status(201).json({ success: true, data: item });
};

export const update = async (req, res) => {
  const { name, unit, parts } = req.body;
  const item = await Item.findById(req.params.id);
  if (!item) {
    return res.status(404).json({ success: false, message: 'Item not found' });
  }
  if (name !== undefined) {
    const trimmed = String(name).trim();
    if (!trimmed) return res.status(400).json({ success: false, message: 'Name is required' });
    item.name = trimmed;
  }
  if (unit !== undefined) item.unit = (unit || 'kg').trim() || 'kg';
  if (Array.isArray(parts)) {
    item.parts = parts
      .filter((p) => p && (p.partName || '').trim())
      .map((p) => ({
        partName: (p.partName || '').trim(),
        unit: (p.unit || 'kg').trim() || 'kg',
      }));
  }
  await item.save();
  res.json({ success: true, data: item.toObject() });
};

export const remove = async (req, res) => {
  // Phase 3/4: check StockEntry and Sale usage — for now allow delete
  const deleted = await Item.findByIdAndDelete(req.params.id);
  if (!deleted) {
    return res.status(404).json({ success: false, message: 'Item not found' });
  }
  res.json({ success: true, message: 'Item deleted' });
};

/**
 * Item khata (ledger): kitna daala (purchases), kis ko kitna becha (sales), profit.
 * Query: dateFrom, dateTo (YYYY-MM-DD).
 */
export const getKhata = async (req, res) => {
  const item = await Item.findById(req.params.id).lean();
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

  const salesWithPart = sales.map((s) => {
    const part = (item.parts || []).find((p) => p._id.toString() === (s.partId && s.partId.toString()));
    return { ...s, partName: part?.partName, partUnit: part?.unit || 'kg' };
  });

  const totalCost = purchases.reduce((sum, p) => sum + (Number(p.amountPaid) || 0), 0);
  const totalRevenue = sales.reduce((sum, s) => sum + (Number(s.amountReceived) || 0), 0);
  const profit = totalRevenue - totalCost;

  res.json({
    success: true,
    data: {
      name: item.name,
      unit: item.unit,
      purchases,
      sales: salesWithPart,
      totalCost,
      totalRevenue,
      profit,
    },
  });
};
