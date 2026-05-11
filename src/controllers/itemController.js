import mongoose from 'mongoose';
import { buildUTCDateFilter } from '../utils/dateUtils.js';

const itemListSelect = 'name categoryId quality';
const itemListPopulate = { path: 'categoryId', select: 'name' };

export const list = async (req, res) => {
  const { Item } = req.models;
  const search = (req.query.search || '').trim();
  const categoryId = (req.query.categoryId || '').trim();
  const parentId = (req.query.parentId || '').trim();
  const filter = {};
  if (search) filter.name = new RegExp(search, 'i');
  if (categoryId) filter.categoryId = new mongoose.Types.ObjectId(categoryId);
  if (parentId) {
    if (parentId === 'none') filter.parentId = null;
    else filter.parentId = new mongoose.Types.ObjectId(parentId);
  }
  const items = await Item.find(filter).populate(itemListPopulate).sort({ name: 1 }).lean();
  res.json({ success: true, data: items });
};

export const getById = async (req, res) => {
  const { Item } = req.models;
  const item = await Item.findById(req.params.id).populate(itemListPopulate).lean();
  if (!item) {
    return res.status(404).json({ success: false, message: 'Item not found' });
  }
  res.json({ success: true, data: item });
};

export const create = async (req, res) => {
  const { Item } = req.models;
  const { name, categoryId, quality, parentId } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, message: 'Name is required' });
  }
  const item = await Item.create({
    name: name.trim(),
    categoryId: categoryId || null,
    quality: (quality || '').trim(),
    parentId: parentId || null,
  });
  const populated = await Item.findById(item._id).populate(itemListPopulate).lean();
  res.status(201).json({ success: true, data: populated });
};

export const update = async (req, res) => {
  const { Item } = req.models;
  const { name, categoryId, quality, parentId } = req.body;
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
  if (parentId !== undefined) item.parentId = parentId || null;
  await item.save();
  const populated = await Item.findById(item._id).populate(itemListPopulate).lean();
  res.json({ success: true, data: populated });
};


/**
 * Item khata (ledger): purchases (stock entries), sales, profit.
 * Query: dateFrom, dateTo (YYYY-MM-DD).
 */
export const getKhata = async (req, res) => {
  const { Item, StockEntry, Sale } = req.models;
  const item = await Item.findById(req.params.id).populate(itemListPopulate).lean();
  if (!item) {
    return res.status(404).json({ success: false, message: 'Item not found' });
  }
  const { dateFrom, dateTo } = req.query;
  const dateFilterObj = buildUTCDateFilter(dateFrom, dateTo);
  const dateFilter = dateFilterObj.date || {};
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

/**
 * Sub-item ledger: only sales for this specific subItemId.
 */
export const getSubItemKhata = async (req, res) => {
  const { Item, Sale } = req.models;
  const item = await Item.findById(req.params.id).populate('parentId').lean();
  if (!item) {
    return res.status(404).json({ success: false, message: 'Sub-item not found' });
  }
  
  const { dateFrom, dateTo } = req.query;
  const dateFilterObj = buildUTCDateFilter(dateFrom, dateTo);
  const dateFilter = dateFilterObj.date || {};
  const hasDateFilter = Object.keys(dateFilter).length > 0;
  const subItemId = new mongoose.Types.ObjectId(req.params.id);

  const salesRaw = await Sale.aggregate([
    { $unwind: '$items' },
    { $match: { 'items.subItemId': subItemId, ...(hasDateFilter ? { date: dateFilter } : {}) } },
    {
      $lookup: {
        from: 'customers',
        localField: 'customerId',
        foreignField: '_id',
        as: 'customerDoc'
      }
    },
    { $unwind: { path: '$customerDoc', preserveNullAndEmptyArrays: true } },
    { $sort: { date: -1 } }
  ]);

  const sales = salesRaw.map(s => {
    const itm = s.items;
    return {
      _id: s._id,
      date: s.date,
      customerId: s.customerDoc ? { _id: s.customerDoc._id, name: s.customerDoc.name } : null,
      truckNumber: s.truckNumber,
      kattay: itm.kattay || 0,
      quantity: itm.quantity || 0,
      rate: itm.rate || 0,
      totalAmount: itm.totalAmount || 0,
      itemName: item.name,
      parentName: item.parentId ? item.parentId.name : '—'
    };
  });

  const totalRevenue = sales.reduce((sum, s) => sum + (Number(s.totalAmount) || 0), 0);
  const totalBagsSold = sales.reduce((sum, s) => sum + (Number(s.kattay) || 0), 0);
  const totalWeightSold = sales.reduce((sum, s) => sum + (Number(s.quantity) || 0), 0);
  const totalMunSold = totalWeightSold / 40;

  res.json({
    success: true,
    data: {
      name: item.name,
      parentName: item.parentId ? item.parentId.name : '—',
      totalRevenue,
      totalBagsSold,
      totalMunSold,
      sales
    }
  });
};

export const getSubItemsSalesSummary = async (req, res) => {
  const { Item, Sale } = req.models;
  const mainItemId = req.params.id;
  const { dateFrom, dateTo } = req.query;

  // 1. Find all sub-items linked to this main item
  const subItems = await Item.find({ parentId: mainItemId }).lean();
  if (!subItems.length) {
    return res.json({ success: true, data: [] });
  }

  const subItemIds = subItems.map(si => si._id);

  // 2. Date filtering
  const dateFilterObj = buildUTCDateFilter(dateFrom, dateTo);
  const dateFilter = dateFilterObj.date || {};
  const hasDateFilter = Object.keys(dateFilter).length > 0;

  // 3. Aggregate sales for these sub-items with Customer lookup to identify Internal Transfers
  const salesSummary = await Sale.aggregate([
    { $unwind: '$items' },
    { 
      $match: { 
        'items.subItemId': { $in: subItemIds },
        ...(hasDateFilter ? { date: dateFilter } : {})
      } 
    },
    {
      $lookup: {
        from: 'customers',
        localField: 'customerId',
        foreignField: '_id',
        as: 'customerDoc'
      }
    },
    { $unwind: '$customerDoc' },
    {
      $group: {
        _id: '$items.subItemId',
        // If customer is a warehouse, it's "In" for this sub-item
        inWeight: { $sum: { $cond: [{ $eq: ['$customerDoc.isWarehouse', true] }, '$items.quantity', 0] } },
        inBags: { $sum: { $cond: [{ $eq: ['$customerDoc.isWarehouse', true] }, '$items.kattay', 0] } },
        // If customer is NOT a warehouse, it's "Out" (Sale) for this sub-item
        outWeight: { $sum: { $cond: [{ $eq: ['$customerDoc.isWarehouse', false] }, '$items.quantity', 0] } },
        outBags: { $sum: { $cond: [{ $eq: ['$customerDoc.isWarehouse', false] }, '$items.kattay', 0] } },
        totalRevenue: { $sum: { $cond: [{ $eq: ['$customerDoc.isWarehouse', false] }, '$items.totalAmount', 0] } },
        saleCount: { $sum: { $cond: [{ $eq: ['$customerDoc.isWarehouse', false] }, 1, 0] } }
      }
    }
  ]);

  // 4. Merge with sub-item names
  const result = subItems.map(si => {
    const summary = salesSummary.find(s => s._id.toString() === si._id.toString());
    const inW = summary ? summary.inWeight : 0;
    const outW = summary ? summary.outWeight : 0;
    
    return {
      _id: si._id,
      name: si.name,
      quality: si.quality,
      inBags: summary ? summary.inBags : 0,
      inWeight: inW,
      inMun: inW / 40,
      outBags: summary ? summary.outBags : 0,
      outWeight: outW,
      outMun: outW / 40,
      balanceBags: (summary ? summary.inBags : 0) - (summary ? summary.outBags : 0),
      balanceWeight: inW - outW,
      balanceMun: (inW - outW) / 40,
      totalRevenue: summary ? summary.totalRevenue : 0,
      saleCount: summary ? summary.saleCount : 0
    };
  });

  res.json({ success: true, data: result });
};


