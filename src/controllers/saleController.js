import mongoose from 'mongoose';
import { toUTCStartOfDay, buildUTCDateFilter } from '../utils/dateUtils.js';

async function getAvailableQuantity(models, itemId, excludeSaleId = null) {
  const { StockEntry, Sale } = models;
  const itemObjId = new mongoose.Types.ObjectId(itemId);
  
  // Sum In from StockEntry.items
  const inResult = await StockEntry.aggregate([
    { $unwind: '$items' },
    { $match: { 'items.itemId': itemObjId } },
    { $group: { _id: null, totalQty: { $sum: '$items.itemNetWeight' }, totalKattay: { $sum: '$items.kattay' } } },
  ]);
  const stockInQty = inResult[0]?.totalQty ?? 0;
  const stockInKattay = inResult[0]?.totalKattay ?? 0;

  // Sum Out from Sale.items
  const saleMatch = { 'items.itemId': itemObjId };
  if (excludeSaleId) saleMatch._id = { $ne: new mongoose.Types.ObjectId(excludeSaleId) };
  
  const outResult = await Sale.aggregate([
    { $unwind: '$items' },
    { $match: saleMatch },
    { $group: { _id: null, totalQty: { $sum: '$items.quantity' }, totalKattay: { $sum: '$items.kattay' } } },
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
  const { availableQty, availableKattay } = await getAvailableQuantity(req.models, itemId, excludeSaleId || null);
  res.json({ success: true, data: { available: availableQty, availableWeight: availableQty, availableKattay } });
};

export const list = async (req, res) => {
  const { Sale } = req.models;
  const { dateFrom, dateTo, customerId, itemId } = req.query;
  const filter = buildUTCDateFilter(dateFrom, dateTo);
  if (customerId) filter.customerId = new mongoose.Types.ObjectId(customerId);
  if (itemId) filter.itemId = new mongoose.Types.ObjectId(itemId);

  const sales = await Sale.find(filter)
    .populate('customerId', 'name')
    .populate({ path: 'items.itemId', select: 'name quality categoryId', populate: { path: 'categoryId', select: 'name' } })
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
  const { Sale } = req.models;
  const sale = await Sale.findById(req.params.id)
    .populate('customerId', 'name')
    .populate({ path: 'items.itemId', select: 'name quality categoryId', populate: { path: 'categoryId', select: 'name' } })
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
  const { Sale, Transaction } = req.models;
  let { date, customerId, items, totalGrossWeight, totalSHCut, amountReceived, totalBardanaAmount, totalMazdori, extras, truckNumber, gatePassNo, goods, accountId, notes, dueDate } = req.body;
  
  // Parse items if they come as a JSON string (typical for FormData)
  if (typeof items === 'string') {
    try {
      items = JSON.parse(items);
    } catch (e) {
      return res.status(400).json({ success: false, message: 'Invalid items format' });
    }
  }

  const grossTotal = Number(totalGrossWeight) || 0;
  const cutTotal = Number(totalSHCut) || 0;
  const netTotal = Math.max(0, grossTotal - cutTotal);

  // Pre-calculate sum of line weights for accurate proportional splitting
  const sumLineGross = items.reduce((sum, item) => {
    const k = Number(item.kattay) || 0;
    const kpk = Number(item.kgPerKata) || 0;
    const dKg = Number(item.deductionKg) || 0;
    const aKg = Number(item.addKg) || 0;
    const lineGross = Number(item.grossWeight) || Math.max(0, (k * kpk) - dKg + aKg);
    return sum + lineGross;
  }, 0);

  // 1. Base Item Processing (Gross, S.H Cut, Initial Total)
  const baseProcessedItems = items.map(item => {
    const k = Number(item.kattay) || 0;
    const kpk = Number(item.kgPerKata) || 0;
    const dKg = Number(item.deductionKg) || 0;
    const aKg = Number(item.addKg) || 0;
    
    // Line Gross logic: if manual grossWeight provided use it, otherwise (k * kpk) - dKg + aKg
    const lineGross = Number(item.grossWeight) || Math.max(0, (k * kpk) - dKg + aKg);
    
    // Proportional SH Cut splitting based on ACTUAL line weights sum
    const lineSHCut = sumLineGross > 0 ? (lineGross / sumLineGross) * cutTotal : 0;
    const lineNet = Math.max(0, lineGross - lineSHCut);
    
    const bRate = Number(item.bardanaRate) || 0;
    const bardana = Number(item.bardanaAmount) || (k * bRate);
    const mazdori = Number(item.mazdori) || 0;
    const rate = Number(item.rate) || 0;
    
    let lineTotal = 0;
    if (lineNet > 0 && rate > 0) {
      lineTotal = Math.round((lineNet / 40) * rate);
    } else {
      lineTotal = (Number(item.totalAmount) || 0);
    }

    return {
      itemId: item.itemId,
      kattay: k,
      kgPerKata: kpk,
      deductionKg: dKg,
      addKg: aKg,
      grossWeight: lineGross,
      shCut: lineSHCut,
      quantity: lineNet,
      rate,
      totalAmount: lineTotal
    };
  });

  // 2. We keep the base line totals (NO LONGER subtracting Extras from line totals)
  const parsedExtras = Number(extras) || 0;
  let finalGrandTotalFromItems = 0;
  const finalProcessedItems = baseProcessedItems.map(item => {
    finalGrandTotalFromItems += item.totalAmount;
    return item;
  });

  const finalTotalAmount = Math.max(0, finalGrandTotalFromItems + (Number(totalBardanaAmount) || 0) + (Number(totalMazdori) || 0) - parsedExtras);

  const received = Number(amountReceived) || 0;
  let paymentStatus = 'pending';
  if (finalTotalAmount > 0 && received >= finalTotalAmount) paymentStatus = 'paid';
  else if (received > 0) paymentStatus = 'partial';

  const sale = await Sale.create({
    // Force UTC Offset
    date: date ? toUTCStartOfDay(date) : toUTCStartOfDay(new Date()),
    customerId,
    totalGrossWeight: grossTotal,
    totalSHCut: cutTotal,
    netWeight: netTotal,
    items: finalProcessedItems,
    truckNumber: (truckNumber || '').trim(),
    gatePassNo: (gatePassNo || '').trim(),
    goods: (goods || '').trim(),
    amountReceived: received,
    totalBardanaAmount: Number(totalBardanaAmount) || 0,
    totalMazdori: Number(totalMazdori) || 0,
    extras: parsedExtras,
    totalAmount: finalTotalAmount,
    accountId: accountId || null,
    notes: (notes || '').trim(),
    dueDate: dueDate ? new Date(dueDate) : null,
    paymentStatus,
    image: req.file ? req.file.filename : null,
  });

  const populated = await Sale.findById(sale._id)
    .populate('customerId', 'name')
    .populate({ path: 'items.itemId', select: 'name quality categoryId', populate: { path: 'categoryId', select: 'name' } })
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
  const { Sale, Transaction } = req.models;
  const sale = await Sale.findById(req.params.id);
  if (!sale) {
    return res.status(404).json({ success: false, message: 'Sale not found' });
  }

  let { date, customerId, items, totalGrossWeight, totalSHCut, amountReceived, totalBardanaAmount, totalMazdori, extras, truckNumber, gatePassNo, goods, accountId, notes, dueDate } = req.body;

  if (typeof items === 'string') {
    try {
      items = JSON.parse(items);
    } catch (e) {
      // items remains a string, handle below
    }
  }

  if (date != null) {
    sale.date = toUTCStartOfDay(date);
  }
  if (customerId != null) sale.customerId = customerId;
  if (amountReceived !== undefined) sale.amountReceived = Number(amountReceived) || 0;
  if (totalBardanaAmount !== undefined) sale.totalBardanaAmount = Number(totalBardanaAmount) || 0;
  if (totalMazdori !== undefined) sale.totalMazdori = Number(totalMazdori) || 0;
  if (extras !== undefined) sale.extras = Number(extras) || 0;
  if (truckNumber !== undefined) sale.truckNumber = (truckNumber || '').trim();
  if (gatePassNo !== undefined) sale.gatePassNo = (gatePassNo || '').trim();
  if (goods !== undefined) sale.goods = (goods || '').trim();
  if (accountId !== undefined) sale.accountId = accountId || null;
  if (notes !== undefined) sale.notes = (notes || '').trim();
  if (dueDate !== undefined) sale.dueDate = dueDate ? new Date(dueDate) : null;
  if (req.file) sale.image = req.file.filename;

  const grossTotal = totalGrossWeight != null ? Number(totalGrossWeight) : sale.totalGrossWeight;
  const cutTotal = totalSHCut != null ? Number(totalSHCut) : sale.totalSHCut;
  sale.totalGrossWeight = grossTotal;
  sale.totalSHCut = cutTotal;
  sale.netWeight = Math.max(0, grossTotal - cutTotal);

  if (items && Array.isArray(items)) {
    const sumLineGross = items.reduce((sum, item) => {
      const k = Number(item.kattay) || 0;
      const kpk = Number(item.kgPerKata) || 0;
      const dKg = Number(item.deductionKg) || 0;
      const aKg = Number(item.addKg) || 0;
      const lineGross = Number(item.grossWeight) || Math.max(0, (k * kpk) - dKg + aKg);
      return sum + lineGross;
    }, 0);

    const baseProcessedItems = items.map(item => {
      const k = Number(item.kattay) || 0;
      const kpk = Number(item.kgPerKata) || 0;
      const dKg = Number(item.deductionKg) || 0;
      const aKg = Number(item.addKg) || 0;
      const lineGross = Number(item.grossWeight) || Math.max(0, (k * kpk) - dKg + aKg);
      const lineSHCut = sumLineGross > 0 ? (lineGross / sumLineGross) * cutTotal : 0;
      const lineNet = Math.max(0, lineGross - lineSHCut);
      const rate = Number(item.rate) || 0;
      
      let lineTotal = 0;
      if (lineNet > 0 && rate > 0) {
        lineTotal = Math.round((lineNet / 40) * rate);
      } else {
        lineTotal = (Number(item.totalAmount) || 0);
      }

      return {
        itemId: item.itemId,
        kattay: k,
        kgPerKata: kpk,
        deductionKg: dKg,
        addKg: aKg,
        grossWeight: lineGross,
        quantity: lineNet,
        rate,
        totalAmount: lineTotal
      };
    });

    sale.items = baseProcessedItems;
    if (extras !== undefined) sale.extras = Number(extras) || 0;
    
    const itemsSum = sale.items.reduce((sum, it) => sum + (it.totalAmount || 0), 0);
    sale.totalAmount = Math.max(0, itemsSum + (sale.totalBardanaAmount || 0) + (sale.totalMazdori || 0) - (sale.extras || 0));
  } else {
    // If items aren't updated, but extras or other fees are:
    if (extras !== undefined) sale.extras = Number(extras) || 0;
    
    const itemsSum = sale.items.reduce((sum, it) => sum + (it.totalAmount || 0), 0);
    sale.totalAmount = Math.max(0, itemsSum + (sale.totalBardanaAmount || 0) + (sale.totalMazdori || 0) - (sale.extras || 0));
  }
  }

  if (amountReceived != null) sale.amountReceived = Number(amountReceived);

  // Recalculate status
  if (sale.totalAmount > 0 && sale.amountReceived >= sale.totalAmount) sale.paymentStatus = 'paid';
  else if (sale.amountReceived > 0) sale.paymentStatus = 'partial';
  else sale.paymentStatus = 'pending';

  await sale.save();

  // NEW: Sync the linked Transaction (initial payment)
  const linkedTrans = await Transaction.findOne({ saleId: sale._id, category: 'Sale Collection' });
  if (linkedTrans) {
    if (sale.amountReceived > 0) {
      linkedTrans.amount = sale.amountReceived;
      linkedTrans.toAccountId = sale.accountId;
      linkedTrans.date = sale.date;
      linkedTrans.customerId = sale.customerId; // Fixed: Sync CustomerId
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
    .populate({ path: 'items.itemId', select: 'name quality categoryId', populate: { path: 'categoryId', select: 'name' } })
    .populate('accountId', 'name')
    .lean();
  res.json({ success: true, data: populated });
};


/**
 * Collect payment against a specific Sale (deposit).
 * Creates a linked Transaction and updates amountReceived/paymentStatus.
 */
export const collectPayment = async (req, res) => {
  const { Sale, Transaction } = req.models;
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

  // Payment logic using global Transaction import

  const transaction = await Transaction.create({
    date: date ? toUTCStartOfDay(date) : toUTCStartOfDay(new Date()),
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
