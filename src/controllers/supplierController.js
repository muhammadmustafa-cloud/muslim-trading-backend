import Supplier from '../models/Supplier.js';
import Customer from '../models/Customer.js';
import Sale from '../models/Sale.js';
import StockEntry from '../models/StockEntry.js';
import Transaction from '../models/Transaction.js';
import mongoose from 'mongoose';

export const list = async (req, res) => {
  const search = (req.query.search || '').trim();
  const filter = search ? { name: new RegExp(search, 'i') } : {};
  const suppliers = await Supplier.find(filter).populate('linkedCustomerId', 'name').sort({ name: 1 }).lean();
  res.json({ success: true, data: suppliers });
};

export const getById = async (req, res) => {
  const supplier = await Supplier.findById(req.params.id).populate('linkedCustomerId', 'name').lean();
  if (!supplier) {
    return res.status(404).json({ success: false, message: 'Supplier not found' });
  }
  res.json({ success: true, data: supplier });
};

export const create = async (req, res) => {
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
  const supplier = await Supplier.findById(req.params.id).lean();
  if (!supplier) {
    return res.status(404).json({ success: false, message: 'Supplier not found' });
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

  // 1. Define Matches
  const stockMatch = { supplierId: req.params.id };
  if (hasDateFilter) stockMatch.date = dateFilter;

  const saleMatch = supplier.linkedCustomerId ? { customerId: supplier.linkedCustomerId } : null;
  if (saleMatch && hasDateFilter) saleMatch.date = dateFilter;

  // Using global Transaction import
  const transMatch = { $or: [{ supplierId: req.params.id }] };
  if (hasDateFilter) transMatch.date = dateFilter;

  // 2. Fetch all data in parallel
  const [stockEntries, sales, transactions] = await Promise.all([
    StockEntry.find(stockMatch).populate('itemId', 'name').lean(),
    saleMatch ? Sale.find(saleMatch).populate('itemId', 'name').lean() : [],
    Transaction.find(transMatch).populate('fromAccountId', 'name').populate('toAccountId', 'name').lean(),
  ]);

  // Backward compatibility: transactions linked via stockEntryId
  const entryIds = stockEntries.map(e => e._id);
  let entryTransactions = [];
  if (entryIds.length > 0) {
    entryTransactions = await Transaction.find({ stockEntryId: { $in: entryIds }, supplierId: { $ne: req.params.id } }).lean();
  }

  // 3. Transform into Ledger Entries
  const ledger = [];

  // Opening Balance
  if (!dateFrom || new Date(dateFrom) <= supplier.createdAt) {
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
    ledger.push({
      date: e.date,
      description: `Purchase: ${e.itemId?.name || 'Item'} (Truck: ${e.truckNumber || 'N/A'})`,
      bags: e.kattay || 0,
      debit: 0,
      credit: e.amount || 0,
      type: 'purchase',
      refId: e._id
    });
  });

  // Sales (Dr for them)
  sales.forEach(s => {
    ledger.push({
      date: s.date,
      description: `Sale: ${s.itemId?.name || 'Item'} (Truck: ${s.truckNumber || 'N/A'})`,
      bags: s.kattay || 0,
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
    const isDebit = p.type === 'withdraw';
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
      ledger: ledger.reverse(),
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
            itemId: '$itemId',
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
