import mongoose from 'mongoose';
import { toUTCStartOfDay, buildUTCDateFilter } from '../utils/dateUtils.js';

export const list = async (req, res) => {
  const { Supplier } = req.models;
  const search = (req.query.search || '').trim();
  const filter = search ? { name: new RegExp(search, 'i') } : {};
  const suppliers = await Supplier.find(filter).populate('linkedCustomerId', 'name').sort({ name: 1 }).lean();
  res.json({ success: true, data: suppliers });
};

export const getById = async (req, res) => {
  const { Supplier } = req.models;
  const supplier = await Supplier.findById(req.params.id).populate('linkedCustomerId', 'name').lean();
  if (!supplier) {
    return res.status(404).json({ success: false, message: 'Supplier not found' });
  }
  res.json({ success: true, data: supplier });
};

export const create = async (req, res) => {
  const { Supplier, Customer } = req.models;
  const { name, phone, address, notes, isAlsoCustomer, linkedCustomerId, createLinkedCustomer, openingBalance } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, message: 'Name is required' });
  }
  const trimmedName = name.trim();
  let supplier = await Supplier.create({
    name: trimmedName,
    phone: (phone || '').trim(),
    address: (address || '').trim(),
    notes: (notes || '').trim(),
    isAlsoCustomer: !!isAlsoCustomer,
    linkedCustomerId: linkedCustomerId || null,
    openingBalance: Number(openingBalance) || 0,
  });
  if (isAlsoCustomer && createLinkedCustomer && !linkedCustomerId) {
    const customer = await Customer.create({
      name: trimmedName,
      phone: (phone || '').trim(),
      address: (address || '').trim(),
      notes: (notes || '').trim(),
      isAlsoSupplier: true,
      linkedSupplierId: supplier._id,
    });
    supplier = await Supplier.findByIdAndUpdate(supplier._id, { linkedCustomerId: customer._id }, { new: true }).lean();
    supplier = await Supplier.findById(supplier._id).populate('linkedCustomerId', 'name').lean();
  } else {
    if (linkedCustomerId) {
      await Customer.findByIdAndUpdate(linkedCustomerId, { isAlsoSupplier: true, linkedSupplierId: supplier._id });
    }
    supplier = await Supplier.findById(supplier._id).populate('linkedCustomerId', 'name').lean();
  }
  res.status(201).json({ success: true, data: supplier });
};

export const update = async (req, res) => {
  const { Supplier, Customer } = req.models;
  if (req.body.name !== undefined && (!req.body.name || !String(req.body.name).trim())) {
    return res.status(400).json({ success: false, message: 'Name is required' });
  }
  const { isAlsoCustomer, linkedCustomerId, createLinkedCustomer } = req.body;
  const supplier = await Supplier.findById(req.params.id);
  if (!supplier) {
    return res.status(404).json({ success: false, message: 'Supplier not found' });
  }
  const updates = {
    name: req.body.name !== undefined ? String(req.body.name).trim() : supplier.name,
    phone: (req.body.phone ?? supplier.phone ?? '').toString().trim(),
    address: (req.body.address ?? supplier.address ?? '').toString().trim(),
    notes: (req.body.notes ?? supplier.notes ?? '').toString().trim(),
    isAlsoCustomer: isAlsoCustomer !== undefined ? !!isAlsoCustomer : supplier.isAlsoCustomer,
    linkedCustomerId: linkedCustomerId !== undefined ? (linkedCustomerId || null) : supplier.linkedCustomerId,
    openingBalance: req.body.openingBalance !== undefined ? Number(req.body.openingBalance) : supplier.openingBalance,
  };
  if (isAlsoCustomer && createLinkedCustomer && !updates.linkedCustomerId) {
    const customer = await Customer.create({
      name: updates.name,
      phone: updates.phone,
      address: updates.address,
      notes: updates.notes,
      isAlsoSupplier: true,
      linkedSupplierId: supplier._id,
    });
    updates.linkedCustomerId = customer._id;
  } else if (updates.linkedCustomerId) {
    await Customer.findByIdAndUpdate(updates.linkedCustomerId, { isAlsoSupplier: true, linkedSupplierId: supplier._id });
  } else if (!updates.isAlsoCustomer) {
    if (supplier.linkedCustomerId) {
      await Customer.findByIdAndUpdate(supplier.linkedCustomerId, { isAlsoSupplier: false, linkedSupplierId: null });
    }
    updates.linkedCustomerId = null;
  }
  const updated = await Supplier.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true })
    .populate('linkedCustomerId', 'name')
    .lean();
  res.json({ success: true, data: updated });
};


/** History: stock entries (unse khareeda) + sales (unko becha) if linked customer. Query: dateFrom, dateTo, type=sales|stock */
export const getHistory = async (req, res) => {
  const { Supplier, Sale, StockEntry, Transaction } = req.models;
  const supplier = await Supplier.findById(req.params.id).lean();
  if (!supplier) {
    return res.status(404).json({ success: false, message: 'Supplier not found' });
  }

  const { dateFrom, dateTo } = req.query;
  const dateFilterObj = buildUTCDateFilter(dateFrom, dateTo);
  const dateFilter = dateFilterObj.date || {};
  const hasDateFilter = Object.keys(dateFilter).length > 0;

  // 1. Define Matches (Unified if linked)
  const supId = req.params.id;
  const custId = supplier.linkedCustomerId;

  const stockMatch = { supplierId: supId };
  if (hasDateFilter) stockMatch.date = dateFilter;

  const saleMatch = custId ? { customerId: custId } : null;
  if (saleMatch && hasDateFilter) saleMatch.date = dateFilter;

  // Unified Transaction match
  const transMatch = { $or: [{ supplierId: supId }] };
  if (custId) {
    transMatch.$or.push({ customerId: custId });
  }
  if (hasDateFilter) transMatch.date = dateFilter;

  // 2. Fetch all data in parallel
  const [stockEntries, sales, transactions] = await Promise.all([
    StockEntry.find(stockMatch).populate('items.itemId', 'name').lean(),
    saleMatch ? Sale.find(saleMatch).populate('items.itemId', 'name').lean() : [],
    Transaction.find(transMatch).populate('fromAccountId', 'name').populate('toAccountId', 'name').lean(),
  ]);

  // Backward compatibility: transactions linked via stockEntryId
  const entryIds = stockEntries.map(e => e._id);
  let entryTransactions = [];
  if (entryIds.length > 0) {
    const existingTransIds = transactions.map(t => t._id.toString());
    entryTransactions = await Transaction.find({ 
      stockEntryId: { $in: entryIds }, 
      _id: { $nin: existingTransIds.map(id => new mongoose.Types.ObjectId(id)) } 
    }).lean();
  }

  // 3. Transform into Ledger Entries
  const ledger = [];

  const startBoundary = dateFrom ? toUTCStartOfDay(dateFrom) : null;
  if (!dateFrom || (startBoundary && startBoundary <= new Date(supplier.createdAt))) {
    ledger.push({
      date: supplier.createdAt,
      description: 'Opening Balance',
      bags: 0,
      debit: supplier.openingBalance > 0 ? supplier.openingBalance : 0,
      credit: supplier.openingBalance < 0 ? Math.abs(supplier.openingBalance) : 0,
      type: 'opening'
    });
  }

  // Purchases (Cr for us/supplier)
  stockEntries.forEach(e => {
    const itemNames = (e.items && e.items.length > 0)
      ? e.items.map(it => it.itemId?.name || 'Item').join(', ')
      : (e.itemId?.name || 'Item');

    const totalBags = (e.items && e.items.length > 0)
      ? e.items.reduce((sum, it) => sum + (it.kattay || 0), 0)
      : (e.kattay || 0);

    // Fix: Calculate from items to get correct amount without double-counting
    // item.amount already includes distributed bardana/mazdori/extras
    const calculatedAmount = (e.items && e.items.length > 0)
      ? e.items.reduce((sum, it) => sum + (Number(it.amount) || 0), 0)
      : Number(e.amount) || 0;

    ledger.push({
      date: e.date,
      description: `Purchase: ${itemNames} (Truck: ${e.truckNumber || 'N/A'})`,
      bags: totalBags,
      debit: 0,
      credit: calculatedAmount,
      type: 'purchase',
      refId: e._id
    });
  });

  // Sales (Dr for them)
  sales.forEach(s => {
    const itemNames = (s.items && s.items.length > 0) 
      ? s.items.map(it => it.itemId?.name || 'Item').join(', ')
      : (s.itemId?.name || 'Item');

    const totalBags = (s.items && s.items.length > 0)
      ? s.items.reduce((sum, it) => sum + (it.kattay || 0), 0)
      : (s.kattay || 0);

    ledger.push({
      date: s.date,
      description: `Sale: ${itemNames} (Truck: ${s.truckNumber || 'N/A'})`,
      bags: totalBags,
      debit: s.totalAmount || 0,
      credit: 0,
      type: 'sale',
      refId: s._id
    });
  });

  // Payments
  const allPayments = [...transactions, ...entryTransactions];
  const seenPayments = new Set();
  const uniquePayments = allPayments.filter(p => {
    if (seenPayments.has(p._id.toString())) return false;
    seenPayments.add(p._id.toString());
    return true;
  });

  uniquePayments.forEach(p => {
    // If withdraw (we paid them) -> Debit
    // If deposit (they paid us - if linked) -> Credit
    // If transfer: check if this supplier is the destination (receiver) -> Debit, else Credit
    const isThisSupplierDest = p.type === 'transfer' && p.supplierId?.toString() === req.params.id;
    const isDebit = p.type === 'withdraw' || isThisSupplierDest;
    ledger.push({
      date: p.date,
      description: `Payment: ${p.note || (isDebit ? 'Paid to Supplier' : 'Received')}`,
      bags: 0,
      debit: isDebit ? p.amount : 0,
      credit: isDebit ? 0 : p.amount,
      type: 'payment',
      refId: p._id
    });
  });

  // 4. Sort and Balance
  ledger.sort((a, b) => new Date(a.date) - new Date(b.date));

  let currentBalance = 0;
  ledger.forEach(item => {
    currentBalance += (item.debit - item.credit);
    item.balance = currentBalance;
  });

  res.json({
    success: true,
    data: {
      name: supplier.name,
      ledger: ledger, // Show oldest first (ascending)
      summary: {
        totalDebit: ledger.reduce((sum, i) => sum + i.debit, 0),
        totalCredit: ledger.reduce((sum, i) => sum + i.credit, 0),
        finalBalance: currentBalance
      }
    },
  });
};

/** Get all suppliers with outstanding balances (Payables) */
export const getPayables = async (req, res) => {
  const { StockEntry } = req.models;
  const payables = await StockEntry.aggregate([
    { $match: { paymentStatus: { $ne: 'paid' }, amount: { $gt: 0 } } },
    {
      $group: {
        _id: '$supplierId',
        totalBillAmount: { $sum: '$amount' },
        totalPaidAmount: { $sum: '$amountPaid' },
        pendingBillsCount: { $sum: 1 },
        bills: {
          $push: {
            _id: '$_id',
            date: '$date',
            items: '$items',
            amount: '$amount',
            amountPaid: '$amountPaid',
            dueDate: '$dueDate',
            paymentStatus: '$paymentStatus',
          }
        }
      }
    },
    {
      $lookup: {
        from: 'suppliers',
        localField: '_id',
        foreignField: '_id',
        as: 'supplier'
      }
    },
    { $unwind: '$supplier' },
    {
      $project: {
        supplierId: '$_id',
        supplierName: '$supplier.name',
        totalBillAmount: 1,
        totalPaidAmount: 1,
        totalRemaining: { $subtract: ['$totalBillAmount', '$totalPaidAmount'] },
        pendingBillsCount: 1,
        bills: 1
      }
    },
    { $sort: { totalRemaining: -1 } }
  ]);

  res.json({ success: true, data: payables });
};
