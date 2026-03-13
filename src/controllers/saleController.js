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
  const { date, customerId, itemId, kattay, kgPerKata, ratePerKata, quantity, rate, bardanaAmount, totalAmount, amountReceived, truckNumber, accountId, notes, dueDate } = req.body;
  if (!customerId || !itemId) {
    return res.status(400).json({ success: false, message: 'customerId and itemId are required' });
  }

  const k = Number(kattay) || 0;
  const kpk = Number(kgPerKata) || 0;
  const rpk = Number(ratePerKata) || 0;

  // Auto-calculate quantity (total weight) from kattay × kgPerKata, or use direct quantity
  const computedQty = k > 0 && kpk > 0 ? k * kpk : (Number(quantity) || 0);
  if (computedQty < 0) return res.status(400).json({ success: false, message: 'Quantity must be >= 0' });

  const { availableQty, availableKattay } = await getAvailableQuantity(itemId);
  if (computedQty > availableQty) {
    return res.status(400).json({ success: false, message: `Stock kam he (Weight). Available: ${availableQty}kg. Aap enter kar rahe hain: ${computedQty}kg.` });
  }
  if (k > availableKattay) {
    return res.status(400).json({ success: false, message: `Stock kam he (Kattay). Available: ${availableKattay} bags. Aap enter kar rahe hain: ${k} bags.` });
  }

  // Auto-calculate totalAmount: kattay × ratePerKata, or quantity × rate, or manual
  const r = Number(rate) || 0;
  const bardana = Number(bardanaAmount) || 0;
  let computedTotal;
  if (k > 0 && rpk > 0) {
    computedTotal = Math.round(k * rpk) + bardana;
  } else if (computedQty > 0 && r > 0) {
    computedTotal = Math.round(computedQty * r) + bardana;
  } else {
    computedTotal = (Number(totalAmount) || 0) + bardana;
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
    ratePerKata: rpk,
    quantity: computedQty,
    bardanaAmount: bardana,
    rate: r,
    totalAmount: computedTotal,
    truckNumber: (truckNumber || '').trim(),
    amountReceived: received,
    accountId: accountId || null,
    notes: (notes || '').trim(),
    dueDate: dueDate ? new Date(dueDate) : null,
    paymentStatus,
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
  const { date, customerId, itemId, kattay, kgPerKata, ratePerKata, quantity, rate, bardanaAmount, totalAmount, amountReceived, truckNumber, accountId, notes, dueDate } = req.body;
  const newItemId = itemId ? new mongoose.Types.ObjectId(itemId) : sale.itemId;

  // Calculate new kattay-based values
  const k = kattay != null ? Number(kattay) : sale.kattay;
  const kpk = kgPerKata != null ? Number(kgPerKata) : sale.kgPerKata;
  const rpk = ratePerKata != null ? Number(ratePerKata) : sale.ratePerKata;

  // Auto-calculate quantity
  let newQty;
  if (k > 0 && kpk > 0) {
    newQty = k * kpk;
  } else {
    newQty = quantity != null ? Number(quantity) : sale.quantity;
  }
  if (newQty < 0) return res.status(400).json({ success: false, message: 'Quantity must be >= 0' });

  const { availableQty, availableKattay } = await getAvailableQuantity(newItemId, sale._id);
  if (newQty > availableQty) {
    return res.status(400).json({ success: false, message: `Stock kam he (Weight). Available: ${availableQty}kg. Aap enter kar rahe hain: ${newQty}kg.` });
  }
  if (k > availableKattay) {
    return res.status(400).json({ success: false, message: `Stock kam he (Kattay). Available: ${availableKattay} bags. Aap enter kar rahe hain: ${k} bags.` });
  }

  // Auto-calculate totalAmount
  const newRate = rate != null ? Number(rate) || 0 : sale.rate;
  const bardana = bardanaAmount != null ? Number(bardanaAmount) : sale.bardanaAmount;
  let computedTotal;
  if (k > 0 && rpk > 0) {
    computedTotal = Math.round(k * rpk) + bardana;
  } else if (newQty > 0 && newRate > 0) {
    computedTotal = Math.round(newQty * newRate) + bardana;
  } else {
    computedTotal = (totalAmount != null ? Number(totalAmount) : sale.totalAmount) + bardana;
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
  sale.ratePerKata = rpk;
  sale.quantity = newQty;
  sale.bardanaAmount = bardana;
  sale.rate = newRate;
  sale.totalAmount = computedTotal;
  if (truckNumber !== undefined) sale.truckNumber = (truckNumber || '').trim();
  sale.amountReceived = received;
  if (accountId !== undefined) sale.accountId = accountId || null;
  if (notes !== undefined) sale.notes = (notes || '').trim();
  if (dueDate !== undefined) sale.dueDate = dueDate ? new Date(dueDate) : null;
  sale.paymentStatus = paymentStatus;
  await sale.save();

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
