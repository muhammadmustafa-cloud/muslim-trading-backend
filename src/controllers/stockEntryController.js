import mongoose from 'mongoose';
import { toUTCStartOfDay, buildUTCDateFilter } from '../utils/dateUtils.js';

export const list = async (req, res) => {
  const { StockEntry } = req.models;
  const { dateFrom, dateTo, itemId, supplierId } = req.query;
  const filter = buildUTCDateFilter(dateFrom, dateTo);
  if (itemId) filter.itemId = new mongoose.Types.ObjectId(itemId);
  if (supplierId) filter.supplierId = new mongoose.Types.ObjectId(supplierId);

  const entries = await StockEntry.find(filter)
    .populate({ path: 'items.itemId', select: 'name quality categoryId', populate: { path: 'categoryId', select: 'name' } })
    .populate('supplierId', 'name')
    .populate('accountId', 'name')
    .sort({ date: -1 })
    .lean();
  res.json({ success: true, data: entries });
};

export const listPending = async (req, res) => {
  const { StockEntry } = req.models;
  const { supplierId } = req.query;
  const filter = { paymentStatus: { $ne: 'paid' } };
  if (supplierId) filter.supplierId = new mongoose.Types.ObjectId(supplierId);

  const entries = await StockEntry.find(filter)
    .populate({ path: 'items.itemId', select: 'name quality categoryId', populate: { path: 'categoryId', select: 'name' } })
    .populate('supplierId', 'name')
    .sort({ dueDate: 1 })
    .lean();
  res.json({ success: true, data: entries });
};

export const getById = async (req, res) => {
  const { StockEntry } = req.models;
  const entry = await StockEntry.findById(req.params.id)
    .populate({ path: 'items.itemId', select: 'name quality categoryId', populate: { path: 'categoryId', select: 'name' } })
    .populate('supplierId', 'name')
    .populate('accountId', 'name')
    .lean();
  if (!entry) {
    return res.status(404).json({ success: false, message: 'Stock entry not found' });
  }
  res.json({ success: true, data: entry });
};

export const create = async (req, res) => {
  const { StockEntry, Transaction } = req.models;
  let { date, supplierId, items, totalGrossWeight, totalSHCut, amountPaid, totalBardanaAmount, totalMazdori, extras, dueDate, truckNumber, gatePassNo, goods, accountId, notes, millWeight, supplierWeight } = req.body;
  
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

  let grandTotalAmount = 0;
  
  // Process each item - simplified approach
  const validItems = items.filter(item => item.itemId);
  const itemCount = validItems.length;
  
  const processedItems = items.map(item => {
    if (!item.itemId) {
      // Return empty item for invalid entries
      return {
        itemId: item.itemId || null,
        kattay: Number(item.kattay) || 0,
        kgPerKata: 0,
        deductionKg: Number(item.deductionKg) || 0,
        addKg: Number(item.addKg) || 0,
        grossWeight: 0,
        shCut: 0,
        itemNetWeight: 0,
        rate: Number(item.rate) || 0,
        amount: 0
      };
    }

    // Equal distribution of total weight among valid items
    const ratio = itemCount > 0 ? 1 / itemCount : 0;
    const lineGross = grossTotal * ratio;
    const lineSHCut = cutTotal * ratio;
    const lineNet = Math.max(0, lineGross - lineSHCut);
    const lineMun = lineNet / 40;
    const r = Number(item.rate) || 0;
    
    // Base amount calculation
    let lineTotalBase = 0;
    if (lineNet > 0 && r > 0) {
      lineTotalBase = Math.round(lineMun * r);
    } else {
      lineTotalBase = Number(item.amount) || 0;
    }

    // Distribute Extras, Bardana and Mazdoori per MUN (like Sales system)
    const bardanaAmount = Number(totalBardanaAmount) || 0;
    const mazdoriAmount = Number(totalMazdori) || 0;
    const parsedExtras = Number(extras) || 0;
    const totalMun = netTotal / 40;
    
    const extraPerMun = totalMun > 0 ? parsedExtras / totalMun : 0;
    const bardanaPerMun = totalMun > 0 ? bardanaAmount / totalMun : 0;
    const mazdoriPerMun = totalMun > 0 ? mazdoriAmount / totalMun : 0;
    
    const itemExtra = lineMun * extraPerMun;
    const itemBardana = lineMun * bardanaPerMun;
    const itemMazdori = lineMun * mazdoriPerMun;
    const lineTotal = Math.round(lineTotalBase + itemBardana + itemMazdori - itemExtra);

    grandTotalAmount += lineTotal;

    return {
      itemId: item.itemId,
      kattay: Number(item.kattay) || 0,
      kgPerKata: 0, // Not used in simplified approach
      deductionKg: Number(item.deductionKg) || 0,
      addKg: Number(item.addKg) || 0,
      grossWeight: lineGross,
      shCut: lineSHCut,
      itemNetWeight: lineNet,
      rate: r,
      bardanaAmount: itemBardana,
      extrasAmount: itemExtra,
      amount: lineTotal
    };
  });

  // NOTE: grandTotalAmount already includes per-item distributed bardana/mazdori/extras
  // Do NOT add totalBardanaAmount/totalMazdori again - that would double count
  const finalTotalAmount = Math.max(0, grandTotalAmount);

  const paid = Number(amountPaid) || 0;
  let status = 'pending';
  if (paid >= finalTotalAmount && finalTotalAmount > 0) status = 'paid';
  else if (paid > 0) status = 'partial';

  const entry = await StockEntry.create({
    // Force UTC Offset
    date: date ? toUTCStartOfDay(date) : toUTCStartOfDay(new Date()),
    supplierId,
    totalGrossWeight: grossTotal,
    totalSHCut: cutTotal || processedItems.reduce((sum, i) => sum + i.shCut, 0),
    receivedWeight: netTotal || processedItems.reduce((sum, i) => sum + i.itemNetWeight, 0),
    items: processedItems,
    millWeight: Number(millWeight) || 0,
    supplierWeight: Number(supplierWeight) || 0,
    amount: finalTotalAmount,
    totalBardanaAmount: Number(totalBardanaAmount) || 0,
    totalMazdori: Number(totalMazdori) || 0,
    extras: parsedExtras,
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
    .populate({ path: 'items.itemId', select: 'name quality categoryId', populate: { path: 'categoryId', select: 'name' } })
    .populate('supplierId', 'name')
    .populate('accountId', 'name')
    .lean();
  res.status(201).json({ success: true, data: populated });
};

export const update = async (req, res) => {
  const { StockEntry, Transaction } = req.models;
  const entry = await StockEntry.findById(req.params.id);
  if (!entry) {
    return res.status(404).json({ success: false, message: 'Stock entry not found' });
  }
  
  let { date, supplierId, items, totalGrossWeight, totalSHCut, amountPaid, totalBardanaAmount, totalMazdori, extras, truckNumber, gatePassNo, goods, accountId, notes, millWeight, supplierWeight } = req.body;

  if (typeof items === 'string') {
    try {
      items = JSON.parse(items);
    } catch (e) {
      // keep as string
    }
  }

  if (date != null) {
    entry.date = toUTCStartOfDay(date);
  }
  if (supplierId != null) entry.supplierId = supplierId;
  if (amountPaid !== undefined) entry.amountPaid = Number(amountPaid) || 0;
  if (totalBardanaAmount !== undefined) entry.totalBardanaAmount = Number(totalBardanaAmount) || 0;
  if (totalMazdori !== undefined) entry.totalMazdori = Number(totalMazdori) || 0;
  if (extras !== undefined) entry.extras = Number(extras) || 0;
  if (truckNumber !== undefined) entry.truckNumber = (truckNumber || '').trim();
  if (gatePassNo !== undefined) entry.gatePassNo = (gatePassNo || '').trim();
  if (goods !== undefined) entry.goods = (goods || '').trim();
  if (millWeight != null) entry.millWeight = Number(millWeight) || 0;
  if (supplierWeight != null) entry.supplierWeight = Number(supplierWeight) || 0;
  if (accountId !== undefined) entry.accountId = accountId || null;
  if (notes !== undefined) entry.notes = (notes || '').trim();
  if (req.body.dueDate !== undefined) {
    entry.dueDate = req.body.dueDate ? toUTCStartOfDay(req.body.dueDate) : null;
  }
  if (req.file) entry.image = req.file.filename;

  const grossTotal = totalGrossWeight != null ? Number(totalGrossWeight) : entry.totalGrossWeight;
  const cutTotal = totalSHCut != null ? Number(totalSHCut) : entry.totalSHCut;
  entry.totalGrossWeight = grossTotal;
  entry.totalSHCut = cutTotal;
  entry.receivedWeight = Math.max(0, grossTotal - cutTotal);

  if (items && Array.isArray(items)) {
    let grandTotalAmount = 0;
    const validItems = items.filter(item => item.itemId);
    const itemCount = validItems.length;
    
    entry.items = items.map(item => {
      if (!item.itemId) {
        // Return empty item for invalid entries
        return {
          itemId: item.itemId || null,
          kattay: Number(item.kattay) || 0,
          kgPerKata: 0,
          deductionKg: Number(item.deductionKg) || 0,
          addKg: Number(item.addKg) || 0,
          grossWeight: 0,
          shCut: 0,
          itemNetWeight: 0,
          rate: Number(item.rate) || 0,
          amount: 0
        };
      }

      // Equal distribution of total weight among valid items
      const ratio = itemCount > 0 ? 1 / itemCount : 0;
      const lineGross = grossTotal * ratio;
      const lineSHCut = cutTotal * ratio;
      const lineNet = Math.max(0, lineGross - lineSHCut);
      const lineMun = lineNet / 40;
      const r = Number(item.rate) || 0;
      
      // Base amount calculation
      let lineTotalBase = 0;
      if (lineNet > 0 && r > 0) {
        lineTotalBase = Math.round(lineMun * r);
      } else {
        lineTotalBase = Number(item.amount) || 0;
      }

      // Distribute Extras, Bardana and Mazdoori per MUN (like Sales system)
      const bardanaAmount = Number(entry.totalBardanaAmount) || 0;
      const mazdoriAmount = Number(entry.totalMazdori) || 0;
      const totalExtras = Number(entry.extras) || 0;
      const totalMun = (grossTotal - cutTotal) / 40;
      
      const extraPerMun = totalMun > 0 ? totalExtras / totalMun : 0;
      const bardanaPerMun = totalMun > 0 ? bardanaAmount / totalMun : 0;
      const mazdoriPerMun = totalMun > 0 ? mazdoriAmount / totalMun : 0;
      
      const itemExtra = lineMun * extraPerMun;
      const itemBardana = lineMun * bardanaPerMun;
      const itemMazdori = lineMun * mazdoriPerMun;
      const lineTotal = Math.round(lineTotalBase + itemBardana + itemMazdori - itemExtra);
      
      grandTotalAmount += lineTotal;

      return {
        itemId: item.itemId,
        kattay: Number(item.kattay) || 0,
        kgPerKata: 0, // Not used in simplified approach
        deductionKg: Number(item.deductionKg) || 0,
        addKg: Number(item.addKg) || 0,
        grossWeight: lineGross,
        shCut: lineSHCut,
        itemNetWeight: lineNet,
        rate: r,
        bardanaAmount: itemBardana,
        extrasAmount: itemExtra,
        amount: lineTotal
      };
    });
  }

  if (extras !== undefined) entry.extras = Number(extras) || 0;

  // Recalculate true total amount from items
  // NOTE: item.amount already includes distributed bardana/mazdori/extras
  // Do NOT add totalBardanaAmount/totalMazdori again - that would double count
  const currentGrandTotal = entry.items.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  entry.amount = Math.max(0, currentGrandTotal);

  if (amountPaid != null) entry.amountPaid = Number(amountPaid);

  // Recalculate status
  if (entry.amountPaid >= entry.amount && entry.amount > 0) entry.paymentStatus = 'paid';
  else if (entry.amountPaid > 0) entry.paymentStatus = 'partial';
  else entry.paymentStatus = 'pending';

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
      linkedTrans.supplierId = entry.supplierId; // Fixed: Sync SupplierId
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
    .populate({ path: 'items.itemId', select: 'name quality categoryId', populate: { path: 'categoryId', select: 'name' } })
    .populate('supplierId', 'name')
    .populate('accountId', 'name')
    .lean();
  res.json({ success: true, data: populated });
};


export const payEntry = async (req, res) => {
  const { StockEntry, Transaction } = req.models;
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
    date: date ? toUTCStartOfDay(date) : toUTCStartOfDay(new Date()),
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
    .populate({ path: 'items.itemId', select: 'name quality categoryId', populate: { path: 'categoryId', select: 'name' } })
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
