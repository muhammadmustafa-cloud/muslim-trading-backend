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
    linkedWarehouseCustomerId: req.body.linkedWarehouseCustomerId || null,
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
  if (req.body.linkedWarehouseCustomerId !== undefined) item.linkedWarehouseCustomerId = req.body.linkedWarehouseCustomerId || null;
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

  const isWarehouseItem = !!item.linkedWarehouseCustomerId;

  res.json({
    success: true,
    data: {
      name: item.name,
      category: item.categoryId?.name ?? '',
      quality: item.quality ?? '',
      purchases: isWarehouseItem ? purchases.map(p => ({ ...p, amount: 0, rate: 0 })) : purchases,
      sales: isWarehouseItem ? salesWithItem.map(s => ({ ...s, totalAmount: 0, rate: 0 })) : salesWithItem,
      totalCost: isWarehouseItem ? 0 : totalCost,
      totalRevenue: isWarehouseItem ? 0 : totalRevenue,
      totalBagsPurchased,
      totalBagsSold,
      stockBalanceBags: Math.max(0, totalBagsPurchased - totalBagsSold),
      stockBalanceMun: Math.max(0, totalMunPurchased - totalMunSold),
      totalMunPurchased,
      totalMunSold,
      profit: isWarehouseItem ? 0 : profit,
      isWarehouseItem,
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
  const { Item, Sale, StockEntry } = req.models;
  const mainItemId = req.params.id;
  const { dateFrom, dateTo } = req.query;

  // 1. Find the main item and its sub-items
  const mainItem = await Item.findById(mainItemId).lean();
  if (!mainItem) return res.status(404).json({ success: false, message: 'Main Item not found' });

  const subItems = await Item.find({ parentId: mainItemId }).lean();
  if (!subItems.length) {
    return res.json({ success: true, data: [] });
  }

  const subItemIds = subItems.map(si => si._id);
  const subItemNames = subItems.map(si => si.name.toLowerCase().trim());

  // 2. Date filtering
  const dateFilterObj = buildUTCDateFilter(dateFrom, dateTo);
  const dateFilter = dateFilterObj.date || {};
  const hasDateFilter = Object.keys(dateFilter).length > 0;

  // 3. Aggregate Purchases (Stock In)
  const purchasesSummary = await StockEntry.aggregate([
    { $unwind: '$items' },
    {
      $match: {
        'items.subItemId': { $in: subItemIds },
        ...(hasDateFilter ? { date: dateFilter } : {})
      }
    },
    {
      $group: {
        _id: '$items.subItemId',
        inWeight: { $sum: '$items.itemNetWeight' },
        inBags: { $sum: '$items.kattay' }
      }
    }
  ]);

  /**
   * 4. Aggregate sales with "Smart Auto-Link" logic:
   * We look for:
   * a) Sales explicitly using a sub-item from our list.
   * b) Sales of ANY item to a Warehouse Customer whose name matches this Main Item.
   */
  const salesSummary = await Sale.aggregate([
    { $unwind: '$items' },
    { 
      $match: { 
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
      $lookup: {
        from: 'items',
        localField: 'items.itemId',
        foreignField: '_id',
        as: 'lineItemDoc'
      }
    },
    { $unwind: '$lineItemDoc' },
    {
      // Smart Filter: Keep sales that belong to this warehouse
      $match: {
        $or: [
          // Case A: Explicitly linked sub-item
          { 'items.subItemId': { $in: subItemIds } },
          // Case B: Sale of a Main Item to THIS Warehouse Customer (by name)
          { 
            'customerDoc.isWarehouse': true, 
            'customerDoc.name': mainItem.name,
            'lineItemDoc.name': { $in: subItems.map(si => si.name) } 
          }
        ]
      }
    },
    {
      $group: {
        _id: {
          $cond: [
            { $in: ['$items.subItemId', subItemIds] },
            '$items.subItemId',
            { $toLower: { $trim: { input: '$lineItemDoc.name' } } }
          ]
        },
        inWeight: { $sum: { $cond: [{ $eq: ['$customerDoc.isWarehouse', true] }, '$items.quantity', 0] } },
        inBags: { $sum: { $cond: [{ $eq: ['$customerDoc.isWarehouse', true] }, '$items.kattay', 0] } },
        outWeight: { $sum: { $cond: [{ $ne: ['$customerDoc.isWarehouse', true] }, '$items.quantity', 0] } },
        outBags: { $sum: { $cond: [{ $ne: ['$customerDoc.isWarehouse', true] }, '$items.kattay', 0] } },
        totalRevenue: { $sum: { $cond: [{ $ne: ['$customerDoc.isWarehouse', true] }, '$items.totalAmount', 0] } },
        saleCount: { $sum: { $cond: [{ $ne: ['$customerDoc.isWarehouse', true] }, 1, 0] } }
      }
    }
  ]);

  // 5. Merge with sub-item names (Summing multiple matches if any)
  const result = subItems.map(si => {
    const matchingSales = salesSummary.filter(s => 
      s._id.toString() === si._id.toString() || 
      (typeof s._id === 'string' && s._id === si.name.toLowerCase().trim())
    );

    const matchingPurchases = purchasesSummary.filter(p =>
      p._id.toString() === si._id.toString()
    );

    const salesMerged = matchingSales.reduce((acc, curr) => ({
      inWeight: acc.inWeight + curr.inWeight,
      inBags: acc.inBags + curr.inBags,
      outWeight: acc.outWeight + curr.outWeight,
      outBags: acc.outBags + curr.outBags,
      totalRevenue: acc.totalRevenue + curr.totalRevenue,
      saleCount: acc.saleCount + curr.saleCount
    }), { inWeight: 0, inBags: 0, outWeight: 0, outBags: 0, totalRevenue: 0, saleCount: 0 });

    const purchasesMerged = matchingPurchases.reduce((acc, curr) => ({
      inWeight: acc.inWeight + curr.inWeight,
      inBags: acc.inBags + curr.inBags
    }), { inWeight: 0, inBags: 0 });

    const totalInWeight = salesMerged.inWeight + purchasesMerged.inWeight;
    const totalInBags = salesMerged.inBags + purchasesMerged.inBags;
    const outW = salesMerged.outWeight;
    
    return {
      _id: si._id,
      name: si.name,
      quality: si.quality,
      inBags: totalInBags,
      inWeight: totalInWeight,
      inMun: totalInWeight / 40,
      outBags: salesMerged.outBags,
      outWeight: outW,
      outMun: outW / 40,
      balanceBags: totalInBags - salesMerged.outBags,
      balanceWeight: totalInWeight - outW,
      balanceMun: (totalInWeight - outW) / 40,
      totalRevenue: salesMerged.totalRevenue,
      saleCount: salesMerged.saleCount
    };
  });

  res.json({ success: true, data: result });
};

export const remove = async (req, res) => {
  const { Item, Sale, StockEntry } = req.models;
  const itemId = req.params.id;

  const item = await Item.findById(itemId);
  if (!item) return res.status(404).json({ success: false, message: "Item not found" });

  // 1. Check if this is a main item and if it has any usage or sub-item usage
  const subItems = await Item.find({ parentId: itemId }).lean();
  const subItemIds = subItems.map(si => si._id);
  const allIdsToCheck = [itemId, ...subItemIds];

  // 2. Check Sales
  const usedInSale = await Sale.findOne({
    $or: [
      { "items.itemId": { $in: allIdsToCheck } },
      { "items.subItemId": { $in: allIdsToCheck } }
    ]
  });
  if (usedInSale) {
    return res.status(400).json({ 
      success: false, 
      message: "Ye Item delete nahi ho sakta kyunke iske Bills (Sales) maujood hain." 
    });
  }

  // 3. Check Stock Entries
  const usedInStock = await StockEntry.findOne({
    $or: [
      { "items.itemId": { $in: allIdsToCheck } },
      { "items.subItemId": { $in: allIdsToCheck } }
    ]
  });
  if (usedInStock) {
    return res.status(400).json({ 
      success: false, 
      message: "Ye Item delete nahi ho sakta kyunke iska Stock (Inward) record maujood hai." 
    });
  }

  // 4. If no usage, delete sub-items first then the main item
  if (subItems.length > 0) {
    await Item.deleteMany({ parentId: itemId });
  }
  await Item.findByIdAndDelete(itemId);

  res.json({ success: true, message: "Item aur uske Sub-items delete kar diye gaye hain." });
};


