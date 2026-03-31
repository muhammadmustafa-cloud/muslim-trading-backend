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
  if (dateFrom) {
    dateFilter.$gte = new Date(`${dateFrom}T00:00:00+05:00`);
  }
  if (dateTo) {
    dateFilter.$lte = new Date(`${dateTo}T23:59:59.999+05:00`);
  }
  const hasDateFilter = Object.keys(dateFilter).length > 0;
  const itemId = new mongoose.Types.ObjectId(req.params.id);

  const [purchasesRaw, salesRaw] = await Promise.all([
    StockEntry.aggregate([
      { $unwind: '$items' },
      { $match: { 'items.itemId': itemId, ...(hasDateFilter ? { date: dateFilter } : {}) } },
      {
        $lookup: {
          from: 'suppliers',
          localField: 'supplierId',
          foreignField: '_id',
          as: 'supplierDoc'
        }
      },
      {
        $lookup: {
          from: 'accounts',
          localField: 'accountId',
          foreignField: '_id',
          as: 'accountDoc'
        }
      },
      { $unwind: { path: '$supplierDoc', preserveNullAndEmptyArrays: true } },
      { $unwind: { path: '$accountDoc', preserveNullAndEmptyArrays: true } },
      { $sort: { date: -1 } },
      { $limit: 1000 }
    ]),
    Sale.aggregate([
      { $unwind: '$items' },
      { $match: { 'items.itemId': itemId, ...(hasDateFilter ? { date: dateFilter } : {}) } },
      {
        $lookup: {
          from: 'customers',
          localField: 'customerId',
          foreignField: '_id',
          as: 'customerDoc'
        }
      },
      {
        $lookup: {
          from: 'accounts',
          localField: 'accountId',
          foreignField: '_id',
          as: 'accountDoc'
        }
      },
      { $unwind: { path: '$customerDoc', preserveNullAndEmptyArrays: true } },
      { $unwind: { path: '$accountDoc', preserveNullAndEmptyArrays: true } },
      { $sort: { date: -1 } },
      { $limit: 1000 }
    ])
  ]);

  // Standardize the shape for the frontend & Handle Weight Fallbacks
  const purchases = purchasesRaw.map(p => {
    const itm = p.items;
    let weight = Number(itm.itemNetWeight) || 0;
    const rateVal = Number(itm.rate) || 0;
    const amt = Number(itm.amount) || 0;

    // Fallback: If weight is missing but rate/amount exist
    if (weight === 0 && rateVal > 0 && amt > 0) {
      weight = (amt / rateVal) * 40;
    }

    return {
      ...p,
      itemId: itm.itemId,
      kattay: itm.kattay,
      kgPerKata: itm.kgPerKata,
      receivedWeight: weight,
      shCut: itm.shCut,
      rate: rateVal,
      amount: amt,
      bardanaAmount: itm.bardanaAmount,
      supplierId: p.supplierDoc ? { _id: p.supplierDoc._id, name: p.supplierDoc.name } : null,
      accountId: p.accountDoc ? { _id: p.accountDoc._id, name: p.accountDoc.name } : null
    };
  });

  const sales = salesRaw.map(s => {
    const itm = s.items;
    let weight = Number(itm.quantity) || 0;
    const rateVal = Number(itm.rate) || 0;
    const totalAmt = Number(itm.totalAmount) || 0;

    // Fallback: If weight is missing but rate/amount exist
    if (weight === 0 && rateVal > 0 && totalAmt > 0) {
      weight = (totalAmt / rateVal) * 40;
    }

    return {
      ...s,
      itemId: itm.itemId,
      kattay: itm.kattay,
      kgPerKata: itm.kgPerKata,
      quantity: weight,
      shCut: itm.shCut,
      rate: rateVal,
      totalAmount: totalAmt,
      bardanaAmount: itm.bardanaAmount,
      mazdori: itm.mazdori,
      customerId: s.customerDoc ? { _id: s.customerDoc._id, name: s.customerDoc.name } : null,
      accountId: s.accountDoc ? { _id: s.accountDoc._id, name: s.accountDoc.name } : null
    };
  });

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
  const totalWeightPurchased = purchases.reduce((sum, p) => sum + (Number(p.receivedWeight) || 0), 0);
  const totalWeightSold = sales.reduce((sum, s) => sum + (Number(s.quantity) || 0), 0);
  const totalMunPurchased = totalWeightPurchased / 40;
  const totalMunSold = totalWeightSold / 40;
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
      stockBalanceBags: Math.max(0, totalBagsPurchased - totalBagsSold),
      stockBalanceMun: Math.max(0, totalMunPurchased - totalMunSold),
      totalMunPurchased,
      totalMunSold,
      profit,
    },
  });
};
