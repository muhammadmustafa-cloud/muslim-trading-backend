import Customer from '../models/Customer.js';
import Supplier from '../models/Supplier.js';
import Sale from '../models/Sale.js';
import StockEntry from '../models/StockEntry.js';
import Transaction from '../models/Transaction.js';
import mongoose from 'mongoose';

export const list = async (req, res) => {
  const search = (req.query.search || '').trim();
  const filter = search ? { name: new RegExp(search, 'i') } : {};
  const customers = await Customer.find(filter).populate('linkedSupplierId', 'name').sort({ name: 1 }).lean();
  res.json({ success: true, data: customers });
};

export const getById = async (req, res) => {
  const customer = await Customer.findById(req.params.id).populate('linkedSupplierId', 'name').lean();
  if (!customer) {
    return res.status(404).json({ success: false, message: 'Customer not found' });
  }
  res.json({ success: true, data: customer });
};

export const create = async (req, res) => {
  const { name, phone, address, notes, isAlsoSupplier, linkedSupplierId, createLinkedSupplier, openingBalance } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, message: 'Name is required' });
  }
  const trimmedName = name.trim();
  let customer = await Customer.create({
    name: trimmedName,
    phone: (phone || '').trim(),
    address: (address || '').trim(),
    notes: (notes || '').trim(),
    isAlsoSupplier: !!isAlsoSupplier,
    linkedSupplierId: linkedSupplierId || null,
    openingBalance: Number(openingBalance) || 0,
  });
  if (isAlsoSupplier && createLinkedSupplier && !linkedSupplierId) {
    const supplier = await Supplier.create({
      name: trimmedName,
      phone: (phone || '').trim(),
      address: (address || '').trim(),
      notes: (notes || '').trim(),
      isAlsoCustomer: true,
      linkedCustomerId: customer._id,
    });
    customer = await Customer.findByIdAndUpdate(customer._id, { linkedSupplierId: supplier._id }, { new: true }).lean();
    customer = await Customer.findById(customer._id).populate('linkedSupplierId', 'name').lean();
  } else {
    if (linkedSupplierId) {
      await Supplier.findByIdAndUpdate(linkedSupplierId, { isAlsoCustomer: true, linkedCustomerId: customer._id });
    }
    customer = await Customer.findById(customer._id).populate('linkedSupplierId', 'name').lean();
  }
  res.status(201).json({ success: true, data: customer });
};

export const update = async (req, res) => {
  if (req.body.name !== undefined && (!req.body.name || !String(req.body.name).trim())) {
    return res.status(400).json({ success: false, message: 'Name is required' });
  }
  const { isAlsoSupplier, linkedSupplierId, createLinkedSupplier } = req.body;
  const customer = await Customer.findById(req.params.id);
  if (!customer) {
    return res.status(404).json({ success: false, message: 'Customer not found' });
  }
  const updates = {
    name: req.body.name !== undefined ? String(req.body.name).trim() : customer.name,
    phone: (req.body.phone ?? customer.phone ?? '').toString().trim(),
    address: (req.body.address ?? customer.address ?? '').toString().trim(),
    notes: (req.body.notes ?? customer.notes ?? '').toString().trim(),
    isAlsoSupplier: isAlsoSupplier !== undefined ? !!isAlsoSupplier : customer.isAlsoSupplier,
    linkedSupplierId: linkedSupplierId !== undefined ? (linkedSupplierId || null) : customer.linkedSupplierId,
    openingBalance: req.body.openingBalance !== undefined ? Number(req.body.openingBalance) : customer.openingBalance,
  };
  if (isAlsoSupplier && createLinkedSupplier && !updates.linkedSupplierId) {
    const supplier = await Supplier.create({
      name: updates.name,
      phone: updates.phone,
      address: updates.address,
      notes: updates.notes,
      isAlsoCustomer: true,
      linkedCustomerId: customer._id,
    });
    updates.linkedSupplierId = supplier._id;
  } else if (updates.linkedSupplierId) {
    await Supplier.findByIdAndUpdate(updates.linkedSupplierId, { isAlsoCustomer: true, linkedCustomerId: customer._id });
  } else if (!updates.isAlsoSupplier) {
    if (customer.linkedSupplierId) {
      await Supplier.findByIdAndUpdate(customer.linkedSupplierId, { isAlsoCustomer: false, linkedCustomerId: null });
    }
    updates.linkedSupplierId = null;
  }
  const updated = await Customer.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true })
    .populate('linkedSupplierId', 'name')
    .lean();
  res.json({ success: true, data: updated });
};


/** History: sales (unse becha) + stock entries (unse khareeda) if linked supplier. Query: dateFrom, dateTo (YYYY-MM-DD), type=sales|stock */
export const getHistory = async (req, res) => {
  const customer = await Customer.findById(req.params.id).lean();
  if (!customer) {
    return res.status(404).json({ success: false, message: 'Customer not found' });
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

  // 1. Define Matches
  const saleMatch = { customerId: req.params.id };
  if (hasDateFilter) saleMatch.date = dateFilter;

  const stockMatch = customer.linkedSupplierId ? { supplierId: customer.linkedSupplierId } : null;
  if (stockMatch && hasDateFilter) stockMatch.date = dateFilter;

  // Transaction match: either linked to a sale of this customer, or directly to this customer
  // Using global Transaction import
  const transMatch = { $or: [{ customerId: req.params.id }] };
  if (hasDateFilter) transMatch.date = dateFilter;

  // 2. Fetch all data in parallel
  const [sales, stockEntries, transactions] = await Promise.all([
    Sale.find(saleMatch).populate('items.itemId', 'name').populate('accountId', 'name').lean(),
    stockMatch ? StockEntry.find(stockMatch).populate('items.itemId', 'name').lean() : [],
    Transaction.find(transMatch).populate('fromAccountId', 'name').populate('toAccountId', 'name').lean(),
  ]);

  // If we have sales, we should also find transactions linked to those sales (backward compatibility)
  const saleIds = sales.map(s => s._id);
  let saleTransactions = [];
  if (saleIds.length > 0) {
    saleTransactions = await Transaction.find({ saleId: { $in: saleIds }, customerId: { $ne: req.params.id } }).lean();
  }

  // 3. Transform into Ledger Entries
  const ledger = [];

  const startBoundary = dateFrom ? new Date(`${dateFrom}T00:00:00+05:00`) : null;
  if (!dateFrom || (startBoundary && startBoundary <= new Date(customer.createdAt))) {
    ledger.push({
      date: customer.createdAt,
      description: 'Opening Balance',
      bags: 0,
      debit: customer.openingBalance > 0 ? customer.openingBalance : 0,
      credit: customer.openingBalance < 0 ? Math.abs(customer.openingBalance) : 0,
      type: 'opening'
    });
  }

  // Sales (Dr for customer)
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

  // Stock Entries (Cr for customer/supplier)
  stockEntries.forEach(e => {
    const itemNames = (e.items && e.items.length > 0)
      ? e.items.map(it => it.itemId?.name || 'Item').join(', ')
      : (e.itemId?.name || 'Item');

    const totalBags = (e.items && e.items.length > 0)
      ? e.items.reduce((sum, it) => sum + (it.kattay || 0), 0)
      : (e.kattay || 0);

    ledger.push({
      date: e.date,
      description: `Purchase: ${itemNames} (Truck: ${e.truckNumber || 'N/A'})`,
      bags: totalBags,
      debit: 0,
      credit: e.amount || 0,
      type: 'purchase',
      refId: e._id
    });
  });

  // Transactions (Payments)
  const allPayments = [...transactions, ...saleTransactions];
  // Deduplicate by _id
  const seenPayments = new Set();
  const uniquePayments = allPayments.filter(p => {
    if (seenPayments.has(p._id.toString())) return false;
    seenPayments.add(p._id.toString());
    return true;
  });

  uniquePayments.forEach(p => {
    // If deposit to us (from customer) -> Credit
    // If withdraw from us (to supplier/customer) -> Debit
    const isCredit = p.type === 'deposit';
    ledger.push({
      date: p.date,
      description: `Payment: ${p.note || (isCredit ? 'Received' : 'Paid')}`,
      bags: 0,
      debit: isCredit ? 0 : p.amount,
      credit: isCredit ? p.amount : 0,
      type: 'payment',
      refId: p._id
    });
  });

  // 4. Sort by Date
  ledger.sort((a, b) => new Date(a.date) - new Date(b.date));

  // 5. Calculate Running Balance
  let currentBalance = 0;
  ledger.forEach(item => {
    currentBalance += (item.debit - item.credit);
    item.balance = currentBalance;
  });

  res.json({
    success: true,
    data: {
      name: customer.name,
      ledger: ledger.reverse(), // Show latest first for UI
      summary: {
        totalDebit: ledger.reduce((sum, i) => sum + i.debit, 0),
        totalCredit: ledger.reduce((sum, i) => sum + i.credit, 0),
        finalBalance: currentBalance
      }
    },
  });
};

/**
 * Returns customers with outstanding receivables (unpaid/partial sales), grouped by customer.
 */
export const getReceivables = async (req, res) => {
  const sales = await Sale.find({ paymentStatus: { $in: ['pending', 'partial'] } })
    .populate('customerId', 'name')
    .populate({ path: 'items.itemId', select: 'name' })
    .sort({ dueDate: 1 })
    .lean();

  const grouped = {};
  for (const s of sales) {
    const cId = s.customerId?._id?.toString();
    if (!cId) continue;
    if (!grouped[cId]) {
      grouped[cId] = {
        customerId: cId,
        customerName: s.customerId?.name || '—',
        totalAmount: 0,
        totalReceived: 0,
        totalRemaining: 0,
        pendingBillsCount: 0,
        bills: [],
      };
    }
    const g = grouped[cId];
    const remaining = (s.totalAmount || 0) - (s.amountReceived || 0);
    g.totalAmount += s.totalAmount || 0;
    g.totalReceived += s.amountReceived || 0;
    g.totalRemaining += remaining;
    g.pendingBillsCount++;
    g.bills.push({
      _id: s._id,
      date: s.date,
      items: s.items,
      totalAmount: s.totalAmount,
      amountReceived: s.amountReceived || 0,
      dueDate: s.dueDate,
      paymentStatus: s.paymentStatus,
      truckNumber: s.truckNumber,
    });
  }

  const data = Object.values(grouped).sort((a, b) => b.totalRemaining - a.totalRemaining);
  res.json({ success: true, data });
};
