import mongoose from 'mongoose';
import { toUTCStartOfDay, buildUTCDateFilter } from '../utils/dateUtils.js';

export const list = async (req, res) => {
  const { Customer } = req.models;
  const search = (req.query.search || '').trim();
  const filter = search ? { name: new RegExp(search, 'i') } : {};
  const customers = await Customer.find(filter).populate('linkedSupplierId', 'name').sort({ name: 1 }).lean();
  res.json({ success: true, data: customers });
};

export const getById = async (req, res) => {
  const { Customer } = req.models;
  const customer = await Customer.findById(req.params.id).populate('linkedSupplierId', 'name').lean();
  if (!customer) {
    return res.status(404).json({ success: false, message: 'Customer not found' });
  }
  res.json({ success: true, data: customer });
};

export const create = async (req, res) => {
  const { Customer, Supplier } = req.models;
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
  const { Customer, Supplier } = req.models;
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
  const { Customer, Sale, StockEntry, Transaction } = req.models;
  const customer = await Customer.findById(req.params.id).lean();
  if (!customer) {
    return res.status(404).json({ success: false, message: 'Customer not found' });
  }

  const { dateFrom, dateTo } = req.query;
  const dateFilterObj = buildUTCDateFilter(dateFrom, dateTo);
  const dateFilter = dateFilterObj.date || {};
  const hasDateFilter = Object.keys(dateFilter).length > 0;

  // 1. Define Matches (Unified if linked)
  const custId = req.params.id;
  const supId = customer.linkedSupplierId;

  const saleMatch = { customerId: custId };
  if (hasDateFilter) saleMatch.date = dateFilter;

  const stockMatch = supId ? { supplierId: supId } : null;
  if (stockMatch && hasDateFilter) stockMatch.date = dateFilter;

  // Unified Transaction match: Check both customer and linked supplier IDs
  const transMatch = {
    $or: [{ customerId: custId }]
  };
  if (supId) {
    transMatch.$or.push({ supplierId: supId });
  }
  if (hasDateFilter) transMatch.date = dateFilter;

  // 2. Fetch all data in parallel
  const [sales, stockEntries, transactions] = await Promise.all([
    Sale.find(saleMatch).populate('items.itemId', 'name').populate('accountId', 'name').lean(),
    stockMatch ? StockEntry.find(stockMatch).populate('items.itemId', 'name').lean() : [],
    Transaction.find(transMatch)
      .populate('fromAccountId', 'name')
      .populate('toAccountId', 'name')
      .populate('customerId', 'name')
      .populate('supplierId', 'name')
      .lean(),
  ]);

  // Backward compatibility: transactions linked via saleId
  const saleIds = sales.map(s => s._id);
  let saleTransactions = [];
  if (saleIds.length > 0) {
    // Only fetch those that aren't already in the transactions list
    const existingTransIds = transactions.map(t => t._id.toString());
    saleTransactions = await Transaction.find({
      saleId: { $in: saleIds },
      _id: { $nin: existingTransIds.map(id => new mongoose.Types.ObjectId(id)) }
    }).lean();
  }

  // 3. Transform into Ledger Entries
  const ledger = [];

  const startBoundary = dateFrom ? toUTCStartOfDay(dateFrom) : null;
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
    const custIdStr = req.params.id;
    const amount = Number(p.amount) || 0;

    let isCredit = false;   // Money coming to customer (or customer receiving)
    let isDebit = false;    // Money going out from customer (customer giving)

    if (!amount) return; // skip zero amount

    // ==================== MAIN LOGIC ====================
    if (p.type === 'deposit') {
      isCredit = true;
    }
    else if (p.type === 'withdraw' || p.type === 'withdrawal') {
      // Withdraw from customer → Debit (money going out)
      isDebit = true;
    }
    else if (p.type === 'transfer') {

      const isCustomerGiver =
        (p.customerId && p.customerId._id?.toString() === custIdStr) ||
        (p.customerId?.toString() === custIdStr) ||
        (p.fromAccountId && String(p.fromAccountId._id || p.fromAccountId) === custIdStr);

      const isCustomerRecipient =
        (p.supplierId && p.supplierId._id?.toString() === custIdStr) ||  // rare
        (p.toAccountId && String(p.toAccountId._id || p.toAccountId) === custIdStr);

      if (isCustomerGiver) {
        isCredit = true;     // Giver = Credit (as per your rule)
      } else if (isCustomerRecipient) {
        isDebit = true;
      }
      else if (p.customerId) {
        // Fallback: if only customerId is set in transfer → treat as giver
        isCredit = true;
      }
    }

    // Ultimate fallback (very important)
    if (!isCredit && !isDebit) {
      // If transaction has customerId and it's this customer → assume Credit (Giver)
      if (p.customerId &&
        (p.customerId._id?.toString() === custIdStr || p.customerId.toString() === custIdStr)) {
        isCredit = true;
      }
    }

    // Description
    let paymentDesc = p.note ? `${p.note} ` : '';

    const fromAccount = p.fromAccountId?.name;
    const toAccount = p.toAccountId?.name;
    const supplierName = p.supplierId?.name;
    const customerName = p.customerId?.name;

    // Build clean description
    // let paymentDesc = '';

    if (p.type === 'deposit') {
      // Customer ne paisa diya (we received)
      paymentDesc = `Received from ${customerName || supplierName || 'Party'} via ${toAccount || 'Cash'}`;
    }
    else if (p.type === 'withdraw' || p.type === 'withdrawal') {
      // Customer ko paisa diya
      paymentDesc = `Paid to ${customerName || supplierName || 'Party'} via ${fromAccount || 'Cash'}`;
    }
    else if (p.type === 'transfer') {

      const isCustomerGiver = isCredit;   // tumhari existing logic use ho rahi hai
      const isCustomerReceiver = isDebit;

      if (isCustomerGiver) {
        // Customer → kisi ko payment
        paymentDesc = `Paid by ${customerName || 'Customer'} (${fromAccount || 'Cash'} → ${toAccount || 'Cash'})`;
      }
      else if (isCustomerReceiver) {
        // Customer ko kisi ne payment diya
        paymentDesc = `Received by ${customerName || 'Customer'} (${fromAccount || 'Cash'} → ${toAccount || 'Cash'})`;
      }
      else {
        paymentDesc = `Transfer (${fromAccount || 'Cash'} → ${toAccount || 'Cash'})`;
      }
    }

    // Note add karo
    if (p.note) {
      paymentDesc += ` (${p.note})`;
    }

    ledger.push({
      date: p.date,
      description: paymentDesc.trim() || 'Transaction',
      bags: 0,
      debit: isDebit ? amount : 0,
      credit: isCredit ? amount : 0,
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
      ledger: ledger, // Show oldest first (ascending)
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
export const remove = async (req, res) => {
  const { Customer, Supplier } = req.models;
  const customer = await Customer.findById(req.params.id);
  if (!customer) {
    return res.status(404).json({ success: false, message: 'Customer not found' });
  }

  // If linked to supplier, unlink
  if (customer.linkedSupplierId) {
    await Supplier.findByIdAndUpdate(customer.linkedSupplierId, {
      isAlsoCustomer: false,
      linkedCustomerId: null
    });
  }

  await Customer.findByIdAndDelete(req.params.id);
  res.json({ success: true, message: 'Customer deleted successfully' });
};

export const getReceivables = async (req, res) => {
  const { Sale } = req.models;
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
