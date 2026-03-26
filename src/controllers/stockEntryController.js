import StockEntry from '../models/StockEntry.js';
import Item from '../models/Item.js';
import Transaction from '../models/Transaction.js';
import mongoose from 'mongoose';

export const list = async (req, res) => {
  const { dateFrom, dateTo, itemId, supplierId } = req.query;
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
  if (itemId) filter.itemId = new mongoose.Types.ObjectId(itemId);
  if (supplierId) filter.supplierId = new mongoose.Types.ObjectId(supplierId);

  const entries = await StockEntry.find(filter)
    .populate({ path: 'itemId', select: 'name quality categoryId', populate: { path: 'categoryId', select: 'name' } })
    .populate('supplierId', 'name')
    .populate('accountId', 'name')
    .sort({ date: -1 })
    .lean();
  res.json({ success: true, data: entries });
};

export const listPending = async (req, res) => {
  const { supplierId } = req.query;
  const filter = { paymentStatus: { $ne: 'paid' } };
  if (supplierId) filter.supplierId = new mongoose.Types.ObjectId(supplierId);

  const entries = await StockEntry.find(filter)
    .populate({ path: 'itemId', select: 'name quality categoryId', populate: { path: 'categoryId', select: 'name' } })
    .populate('supplierId', 'name')
    .sort({ dueDate: 1 })
    .lean();
  res.json({ success: true, data: entries });
};

export const getById = async (req, res) => {
  const entry = await StockEntry.findById(req.params.id)
    .populate({ path: 'itemId', select: 'name quality categoryId', populate: { path: 'categoryId', select: 'name' } })
    .populate('supplierId', 'name')
    .populate('accountId', 'name')
    .lean();
  if (!entry) {
    return res.status(404).json({ success: false, message: 'Stock entry not found' });
  }
  res.json({ success: true, data: entry });
};

export const create = async (req, res) => {
  const { date, itemId, supplierId, receivedWeight, kattay, kgPerKata, millWeight, supplierWeight, rate, shCut, amount, bardanaAmount, amountPaid, dueDate, truckNumber, gatePassNo, goods, accountId, notes } = req.body;
  if (!itemId || !supplierId) {
    return res.status(400).json({ success: false, message: 'itemId and supplierId are required' });
  }
  const item = await Item.findById(itemId).lean();
  if (!item) return res.status(400).json({ success: false, message: 'Item not found' });

  const k = Number(kattay) || 0;
  const kg = Number(kgPerKata) || 0;
  const grossWeight = k > 0 && kg > 0 ? k * kg : (receivedWeight != null ? Number(receivedWeight) : 0);
  
  // Standard Rule for Purchase: 250g (0.25kg) cut per 40kg (1 MUN)
  const sCut = shCut != null && Number(shCut) > 0 ? Number(shCut) : Number(((grossWeight / 40) * 0.25).toFixed(2));
  const computedWeight = Math.max(0, grossWeight - sCut);

  const r = Number(rate) || 0;
  const bardana = bardanaAmount != null ? Number(bardanaAmount) : 0;
  
  // Professional MUN Based Calculation: (NetWeight / 40) * Rate + Bardana
  let amt = 0;
  if (computedWeight > 0 && r > 0) {
    amt = Math.round((computedWeight / 40) * r) + bardana;
  } else {
    amt = amount != null ? Number(amount) : 0;
  }

  const paid = amountPaid != null ? Number(amountPaid) : 0;
  let status = 'pending';
  if (paid >= amt && amt > 0) status = 'paid';
  else if (paid > 0) status = 'partial';

  const entry = await StockEntry.create({
    date: date ? new Date(date) : new Date(),
    itemId,
    supplierId,
    receivedWeight: computedWeight,
    shCut: sCut,
    kattay: k,
    kgPerKata: kg,
    millWeight: millWeight != null ? Number(millWeight) : 0,
    supplierWeight: supplierWeight != null ? Number(supplierWeight) : 0,
    rate: r,
    amount: amt,
    bardanaAmount: bardana,
    amountPaid: paid,
    dueDate: dueDate ? new Date(dueDate) : null,
    paymentStatus: status,
    truckNumber: (truckNumber || '').trim(),
    gatePassNo: (gatePassNo || '').trim(),
    goods: (goods || '').trim(),
    image: req.file ? req.file.filename : null,
    accountId: accountId || null,
    notes: (notes || '').trim(),
  });

  // NEW: Create linked Transaction for initial payment
  if (paid > 0 && accountId) {
    await Transaction.create({
      date: entry.date,
      type: 'withdraw',
      fromAccountId: accountId,
      amount: paid,
      category: 'Supplier Payment',
      note: (notes || '').trim() || `Initial payment for Stock Entry #${entry._id.toString().slice(-6).toUpperCase()}`,
      stockEntryId: entry._id,
      supplierId: entry.supplierId,
    });
  }

  const populated = await StockEntry.findById(entry._id)
    .populate({ path: 'itemId', select: 'name quality categoryId', populate: { path: 'categoryId', select: 'name' } })
    .populate('supplierId', 'name')
    .populate('accountId', 'name')
    .lean();
  res.status(201).json({ success: true, data: populated });
};

export const update = async (req, res) => {
  const entry = await StockEntry.findById(req.params.id);
  if (!entry) {
    return res.status(404).json({ success: false, message: 'Stock entry not found' });
  }
  const { date, itemId, supplierId, receivedWeight, kattay, kgPerKata, millWeight, supplierWeight, rate, shCut, amount, bardanaAmount, amountPaid, truckNumber, gatePassNo, goods, accountId, notes } = req.body;
  if (date != null) entry.date = new Date(date);
  if (itemId != null) entry.itemId = itemId;
  if (supplierId != null) entry.supplierId = supplierId;
  if (truckNumber !== undefined) entry.truckNumber = (truckNumber || '').trim();
  if (gatePassNo !== undefined) entry.gatePassNo = (gatePassNo || '').trim();
  if (goods !== undefined) entry.goods = (goods || '').trim();
  const k = kattay != null ? Number(kattay) || 0 : entry.kattay;
  const kg = kgPerKata != null ? Number(kgPerKata) || 0 : entry.kgPerKata;
  const gross = k > 0 && kg > 0 ? k * kg : (receivedWeight != null ? Number(receivedWeight) : (entry.receivedWeight + (entry.shCut || 0)));
  
  let sCut;
  if (shCut != null) {
      sCut = Number(shCut);
  } else if (kattay != null || kgPerKata != null) {
      sCut = Number(((gross / 40) * 0.25).toFixed(2));
  } else {
      sCut = entry.shCut || 0;
  }
  
  entry.shCut = sCut;
  entry.receivedWeight = Math.max(0, gross - sCut);
  
  if (kattay != null) entry.kattay = k;
  if (kgPerKata != null) entry.kgPerKata = kg;
  if (millWeight != null) entry.millWeight = Number(millWeight) || 0;
  if (supplierWeight != null) entry.supplierWeight = Number(supplierWeight) || 0;
  
  const r = rate != null ? Number(rate) : entry.rate;
  if (rate != null) entry.rate = r;
  
  const bardana = bardanaAmount != null ? Number(bardanaAmount) : entry.bardanaAmount;
  if (bardanaAmount != null) entry.bardanaAmount = bardana;
  
  if (amount != null) {
    entry.amount = Number(amount);
  } else if (rate != null || kattay != null || kgPerKata != null || bardanaAmount != null) {
    entry.amount = Math.round((entry.receivedWeight / 40) * r) + bardana;
  }
  
  if (amountPaid != null) entry.amountPaid = Number(amountPaid);
  if (req.body.dueDate !== undefined) entry.dueDate = req.body.dueDate ? new Date(req.body.dueDate) : null;

  // Recalculate status
  if (entry.amountPaid >= entry.amount && entry.amount > 0) entry.paymentStatus = 'paid';
  else if (entry.amountPaid > 0) entry.paymentStatus = 'partial';
  else entry.paymentStatus = 'pending';

  if (accountId !== undefined) entry.accountId = accountId || null;
  if (notes !== undefined) entry.notes = (notes || '').trim();
  if (req.file) {
    entry.image = req.file.filename;
  }
  await entry.save();

  // NEW: Sync the linked Transaction (only if it was the initial or auto-created one)
  // Subsequent payments via payEntry create their own transactions, so we look for 
  // the one that might exist or should exist based on amountPaid.
  // Actually, simplifying: update the "Initial Payment" transaction if it exists.
  const linkedTrans = await Transaction.findOne({ stockEntryId: entry._id, category: 'Supplier Payment' });
  if (linkedTrans) {
    if (entry.amountPaid > 0) {
      linkedTrans.amount = entry.amountPaid;
      linkedTrans.fromAccountId = entry.accountId;
      linkedTrans.date = entry.date;
      await linkedTrans.save();
    } else {
      await Transaction.findByIdAndDelete(linkedTrans._id);
    }
  } else if (entry.amountPaid > 0 && entry.accountId) {
    await Transaction.create({
      date: entry.date,
      type: 'withdraw',
      fromAccountId: entry.accountId,
      amount: entry.amountPaid,
      category: 'Supplier Payment',
      note: entry.notes || `Initial payment for Stock Entry #${entry._id.toString().slice(-6).toUpperCase()}`,
      stockEntryId: entry._id,
      supplierId: entry.supplierId,
    });
  }

  const populated = await StockEntry.findById(entry._id)
    .populate({ path: 'itemId', select: 'name quality categoryId', populate: { path: 'categoryId', select: 'name' } })
    .populate('supplierId', 'name')
    .populate('accountId', 'name')
    .lean();
  res.json({ success: true, data: populated });
};


export const payEntry = async (req, res) => {
  const { amount, accountId, date, note } = req.body;
  const entryId = req.params.id;

  if (!amount || amount <= 0) {
    return res.status(400).json({ success: false, message: 'Valid amount is required' });
  }
  if (!accountId) {
    return res.status(400).json({ success: false, message: 'AccountId is required' });
  }

  const entry = await StockEntry.findById(entryId);
  if (!entry) {
    return res.status(404).json({ success: false, message: 'Stock entry not found' });
  }

  const remaining = entry.amount - entry.amountPaid;
  if (amount > remaining) {
    return res.status(400).json({ success: false, message: `Payment amount (${amount}) exceeds remaining balance (${remaining})` });
  }

  // 1. Create Transaction
  const transaction = await Transaction.create({
    date: date ? new Date(date) : new Date(),
    type: 'withdraw',
    fromAccountId: accountId,
    amount: Number(amount),
    category: 'Supplier Payment',
    note: (note || '').trim() || `Payment for Stock Entry #${entry._id.toString().slice(-6).toUpperCase()}`,
    stockEntryId: entry._id,
    supplierId: entry.supplierId, // Ensure linking for ledger
  });

  // 2. Update Stock Entry
  entry.amountPaid += Number(amount);

  if (entry.amountPaid >= entry.amount) entry.paymentStatus = 'paid';
  else if (entry.amountPaid > 0) entry.paymentStatus = 'partial';
  else entry.paymentStatus = 'pending';

  await entry.save();

  const populated = await StockEntry.findById(entry._id)
    .populate({ path: 'itemId', select: 'name quality categoryId', populate: { path: 'categoryId', select: 'name' } })
    .populate('supplierId', 'name')
    .populate('accountId', 'name')
    .lean();

  res.json({
    success: true,
    message: 'Payment recorded successfully',
    data: {
      stockEntry: populated,
      transaction
    }
  });
};
