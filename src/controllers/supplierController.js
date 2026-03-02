import Supplier from '../models/Supplier.js';
import Customer from '../models/Customer.js';
import Sale from '../models/Sale.js';
import StockEntry from '../models/StockEntry.js';

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
  const { name, phone, address, notes, isAlsoCustomer, linkedCustomerId, createLinkedCustomer } = req.body;
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

export const remove = async (req, res) => {
  const deleted = await Supplier.findByIdAndDelete(req.params.id);
  if (!deleted) {
    return res.status(404).json({ success: false, message: 'Supplier not found' });
  }
  if (deleted.linkedCustomerId) {
    await Customer.findByIdAndUpdate(deleted.linkedCustomerId, { isAlsoSupplier: false, linkedSupplierId: null });
  }
  res.json({ success: true, message: 'Supplier deleted' });
};

/** History: stock entries (unse khareeda) + sales (unko becha) if linked customer. Query: dateFrom, dateTo, type=sales|stock */
export const getHistory = async (req, res) => {
  const supplier = await Supplier.findById(req.params.id).lean();
  if (!supplier) {
    return res.status(404).json({ success: false, message: 'Supplier not found' });
  }
  const { dateFrom, dateTo, type } = req.query;
  const dateFilter = {};
  if (dateFrom) dateFilter.$gte = new Date(dateFrom);
  if (dateTo) {
    const d = new Date(dateTo);
    d.setHours(23, 59, 59, 999);
    dateFilter.$lte = d;
  }
  const hasDateFilter = Object.keys(dateFilter).length > 0;
  const stockMatch = { supplierId: req.params.id };
  if (hasDateFilter) stockMatch.date = dateFilter;
  const saleMatch = supplier.linkedCustomerId ? { customerId: supplier.linkedCustomerId } : null;
  if (saleMatch && hasDateFilter) saleMatch.date = dateFilter;

  const fetchStock = !type || type === 'stock';
  const fetchSales = (!type || type === 'sales') && supplier.linkedCustomerId;

  const [stockEntries, sales] = await Promise.all([
    fetchStock
      ? StockEntry.find(stockMatch)
          .populate('itemId', 'name')
          .sort({ date: -1 })
          .limit(500)
          .lean()
      : [],
    fetchSales && saleMatch
      ? Sale.find(saleMatch)
          .populate({ path: 'itemId', select: 'name quality categoryId', populate: { path: 'categoryId', select: 'name' } })
          .populate('accountId', 'name')
          .sort({ date: -1 })
          .limit(500)
          .lean()
      : [],
  ]);
  const salesWithItem = sales.map((s) => ({
    ...s,
    itemName: s.itemId?.name ?? '—',
    category: s.itemId?.categoryId?.name ?? '—',
    quality: s.itemId?.quality ?? '—',
  }));
  res.json({
    success: true,
    data: {
      name: supplier.name,
      stockEntries,
      sales: salesWithItem,
      linkedCustomer: supplier.linkedCustomerId ? { _id: supplier.linkedCustomerId } : null,
    },
  });
};
