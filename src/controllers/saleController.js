import Sale from '../models/Sale.js';
import StockEntry from '../models/StockEntry.js';
import Item from '../models/Item.js';
import mongoose from 'mongoose';

async function getAvailableQuantity(itemId, excludeSaleId = null) {
  const itemObjId = new mongoose.Types.ObjectId(itemId);
  const inResult = await StockEntry.aggregate([
    { $match: { itemId: itemObjId } },
    { $group: { _id: null, totalQty: { $sum: '$receivedWeight' }, totalKattay: { $sum: '$kattay' } } },
  ]);
  const stockInQty = inResult[0]?.totalQty ?? 0;
  const stockInKattay = inResult[0]?.totalKattay ?? 0;

  const saleMatch = { itemId: itemObjId };
  if (excludeSaleId) saleMatch._id = { $ne: new mongoose.Types.ObjectId(excludeSaleId) };
  const outResult = await Sale.aggregate([
    { $match: saleMatch },
    { $group: { _id: null, totalQty: { $sum: '$quantity' }, totalKattay: { $sum: '$kattay' } } },
  ]);
  const stockOutQty = outResult[0]?.totalQty ?? 0;
  const stockOutKattay = outResult[0]?.totalKattay ?? 0;

  return {
    availableQty: Math.max(0, stockInQty - stockOutQty),
    availableKattay: Math.max(0, stockInKattay - stockOutKattay),
  };
}

export const getAvailable = async (req, res) => {
  const { itemId, excludeSaleId } = req.query;
  if (!itemId) {
    return res.status(400).json({ success: false, message: 'itemId required' });
  }
  const { availableQty, availableKattay } = await getAvailableQuantity(itemId, excludeSaleId || null);
  res.json({ success: true, data: { available: availableQty, availableWeight: availableQty, availableKattay } });
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
  const { date, customerId, itemId, kattay, kgPerKata, quantity, shCut, bardanaRate, bardanaAmount, mazdori, rate, totalAmount, amountReceived, truckNumber, gatePassNo, goods, accountId, notes, dueDate } = req.body;
  if (!customerId || !itemId) {
    return res.status(400).json({ success: false, message: 'customerId and itemId are required' });
  }

  const k = Number(kattay) || 0;
  const kpk = Number(kgPerKata) || 0;
  const sCut = Number(shCut) || 0;

  // Use the provided quantity (Net Weight) directly as per manual entry requirement
  const computedQty = Number(quantity) || 0;
  
  if (computedQty < 0) return res.status(400).json({ success: false, message: 'Quantity must be >= 0' });

  // NOTE: Stock validation removed to support manufacturing journey (Item A -> B + C)
  // Owner will reconcile stock every 6 months.

  const bRate = Number(bardanaRate) || 0;
  // Auto-calculate bardanaAmount: kattay × bardanaRate OR use manual bardanaAmount
  const bardana = bRate > 0 && k > 0 ? (k * bRate) : (Number(bardanaAmount) || 0);
  
  const mazdoriAmt = Number(mazdori) || 0;
  const r = Number(rate) || 0;

  // Auto-calculate totalAmount: 
  // (Quantity / 40) × rate (since rate is per MUN based on user feedback)
  let computedTotal;
  if (computedQty > 0 && r > 0) {
    const mun = computedQty / 40;
    computedTotal = Math.round(mun * r) + bardana + mazdoriAmt;
  } else {
    computedTotal = (Number(totalAmount) || 0) + bardana + mazdoriAmt;
  }

  const received = Number(amountReceived) || 0;

  // Auto paymentStatus
  let paymentStatus = 'pending';
  if (computedTotal > 0 && received >= computedTotal) paymentStatus = 'paid';
  else if (received > 0) paymentStatus = 'partial';

  const sale = await Sale.create({
    date: date ? new Date(date) : new Date(),
    customerId,
    itemId,
    kattay: k,
    kgPerKata: kpk,
    quantity: computedQty,
    shCut: sCut,
    bardanaRate: bRate,
    bardanaAmount: bardana,
    mazdori: mazdoriAmt,
    rate: r,
    totalAmount: computedTotal,
    truckNumber: (truckNumber || '').trim(),
    gatePassNo: (gatePassNo || '').trim(),
    goods: (goods || '').trim(),
    amountReceived: received,
    accountId: accountId || null,
    notes: (notes || '').trim(),
    dueDate: dueDate ? new Date(dueDate) : null,
    paymentStatus,
    image: req.file ? req.file.filename : null,
  });

  const populated = await Sale.findById(sale._id)
    .populate('customerId', 'name')
    .populate({ path: 'itemId', select: 'name quality categoryId', populate: { path: 'categoryId', select: 'name' } })
    .populate('accountId', 'name')
    .lean();

  // NEW: Create linked Transaction for initial payment
  if (received > 0 && accountId) {
    await Transaction.create({
      date: sale.date,
      type: 'deposit',
      toAccountId: accountId,
      amount: received,
      category: 'Sale Collection',
      note: (notes || '').trim() || `Initial payment for Sale #${sale._id.toString().slice(-6).toUpperCase()}`,
      saleId: sale._id,
      customerId: sale.customerId,
    });
  }

  const row = { ...populated, itemName: populated.itemId?.name, category: populated.itemId?.categoryId?.name, quality: populated.itemId?.quality };
  res.status(201).json({ success: true, data: row });
};

export const update = async (req, res) => {
  const sale = await Sale.findById(req.params.id);
  if (!sale) {
    return res.status(404).json({ success: false, message: 'Sale not found' });
  }
  const { date, customerId, itemId, kattay, kgPerKata, ratePerKata, quantity, shCut, bardanaRate, bardanaAmount, mazdori, rate, totalAmount, amountReceived, truckNumber, gatePassNo, goods, accountId, notes, dueDate } = req.body;
  const newItemId = itemId ? new mongoose.Types.ObjectId(itemId) : sale.itemId;

  // Calculate new kattay-based values
  const k = kattay != null ? Number(kattay) : sale.kattay;
  const kpk = kgPerKata != null ? Number(kgPerKata) : sale.kgPerKata;
  const sCut = Number(shCut) || 0;

  // Use the provided quantity (Net Weight) directly
  const newQty = Number(quantity) || 0;
  if (newQty < 0) return res.status(400).json({ success: false, message: 'Quantity must be >= 0' });

  // NOTE: Stock validation removed to support manufacturing journey

  // Auto-calculate totalAmount
  const newRate = rate != null ? Number(rate) || 0 : sale.rate;
  const bRate = bardanaRate != null ? Number(bardanaRate) : (sale.bardanaRate || 0);
  const bardana = bRate > 0 && k > 0 ? (k * bRate) : (bardanaAmount != null ? Number(bardanaAmount) : sale.bardanaAmount);
  const mazdoriAmt = mazdori != null ? Number(mazdori) : (sale.mazdori || 0);

  let computedTotal;
  if (newQty > 0 && newRate > 0) {
    const mun = newQty / 40;
    computedTotal = Math.round(mun * newRate) + bardana + mazdoriAmt;
  } else {
    computedTotal = (totalAmount != null ? Number(totalAmount) : sale.totalAmount) + bardana + mazdoriAmt;
  }

  const received = amountReceived != null ? Number(amountReceived) : sale.amountReceived;

  // Auto paymentStatus
  let paymentStatus = 'pending';
  if (computedTotal > 0 && received >= computedTotal) paymentStatus = 'paid';
  else if (received > 0) paymentStatus = 'partial';

  if (date != null) sale.date = new Date(date);
  if (customerId != null) sale.customerId = customerId;
  if (itemId != null) sale.itemId = newItemId;
  sale.kattay = k;
  sale.kgPerKata = kpk;
  sale.quantity = newQty;
  sale.shCut = sCut;
  sale.bardanaRate = bRate;
  sale.bardanaAmount = bardana;
  sale.mazdori = mazdoriAmt;
  sale.rate = newRate;
  sale.totalAmount = computedTotal;
  if (truckNumber !== undefined) sale.truckNumber = (truckNumber || '').trim();
  if (gatePassNo !== undefined) sale.gatePassNo = (gatePassNo || '').trim();
  if (goods !== undefined) sale.goods = (goods || '').trim();
  sale.amountReceived = received;
  if (accountId !== undefined) sale.accountId = accountId || null;
  if (notes !== undefined) sale.notes = (notes || '').trim();
  if (dueDate !== undefined) sale.dueDate = dueDate ? new Date(dueDate) : null;
  sale.paymentStatus = paymentStatus;
  if (req.file) {
    sale.image = req.file.filename;
  }
  await sale.save();

  // NEW: Sync the linked Transaction (initial payment)
  const linkedTrans = await Transaction.findOne({ saleId: sale._id, category: 'Sale Collection' });
  if (linkedTrans) {
    if (sale.amountReceived > 0) {
      linkedTrans.amount = sale.amountReceived;
      linkedTrans.toAccountId = sale.accountId;
      linkedTrans.date = sale.date;
      await linkedTrans.save();
    } else {
      await Transaction.findByIdAndDelete(linkedTrans._id);
    }
  } else if (sale.amountReceived > 0 && sale.accountId) {
    await Transaction.create({
      date: sale.date,
      type: 'deposit',
      toAccountId: sale.accountId,
      amount: sale.amountReceived,
      category: 'Sale Collection',
      note: sale.notes || `Initial payment for Sale #${sale._id.toString().slice(-6).toUpperCase()}`,
      saleId: sale._id,
      customerId: sale.customerId,
    });
  }

  const populated = await Sale.findById(sale._id)
    .populate('customerId', 'name')
    .populate({ path: 'itemId', select: 'name quality categoryId', populate: { path: 'categoryId', select: 'name' } })
    .populate('accountId', 'name')
    .lean();
  const row = { ...populated, itemName: populated.itemId?.name, category: populated.itemId?.categoryId?.name, quality: populated.itemId?.quality };
  res.json({ success: true, data: row });
};


/**
 * Collect payment against a specific Sale (deposit).
 * Creates a linked Transaction and updates amountReceived/paymentStatus.
 */
export const collectPayment = async (req, res) => {
  const sale = await Sale.findById(req.params.id);
  if (!sale) {
    return res.status(404).json({ success: false, message: 'Sale not found' });
  }

  const { amount, accountId, date, note } = req.body;
  const amt = Number(amount);
  if (isNaN(amt) || amt <= 0) {
    return res.status(400).json({ success: false, message: 'Amount must be a positive number' });
  }
  if (!accountId) {
    return res.status(400).json({ success: false, message: 'accountId is required' });
  }

  const remaining = sale.totalAmount - (sale.amountReceived || 0);
  if (amt > remaining) {
    return res.status(400).json({ success: false, message: `Amount exceeds remaining balance of ${remaining}` });
  }

  const Transaction = (await import('../models/Transaction.js')).default;

  const transaction = await Transaction.create({
    date: date ? new Date(date) : new Date(),
    type: 'deposit',
    fromAccountId: null,
    toAccountId: accountId,
    amount: amt,
    category: 'Sale Collection',
    note: (note || '').trim() || `Payment collected for Sale #${sale._id.toString().slice(-6).toUpperCase()}`,
    saleId: sale._id,
    customerId: sale.customerId, // Ensure linking for ledger
  });

  sale.amountReceived = (sale.amountReceived || 0) + amt;
  if (sale.amountReceived >= sale.totalAmount) sale.paymentStatus = 'paid';
  else if (sale.amountReceived > 0) sale.paymentStatus = 'partial';
  await sale.save();

  res.json({
    success: true,
    data: { sale, transaction },
    message: `Rs. ${amt.toLocaleString()} collected successfully.`,
  });
};
