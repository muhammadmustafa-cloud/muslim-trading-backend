import Customer from '../models/Customer.js';
import Supplier from '../models/Supplier.js';
import Sale from '../models/Sale.js';
import StockEntry from '../models/StockEntry.js';
import Item from '../models/Item.js';

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
  const { name, phone, address, notes, isAlsoSupplier, linkedSupplierId, createLinkedSupplier } = req.body;
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

export const remove = async (req, res) => {
  const deleted = await Customer.findByIdAndDelete(req.params.id);
  if (!deleted) {
    return res.status(404).json({ success: false, message: 'Customer not found' });
  }
  if (deleted.linkedSupplierId) {
    await Supplier.findByIdAndUpdate(deleted.linkedSupplierId, { isAlsoCustomer: false, linkedCustomerId: null });
  }
  res.json({ success: true, message: 'Customer deleted' });
};

/** History: sales (unse becha) + stock entries (unse khareeda) if linked supplier. Query: dateFrom, dateTo (YYYY-MM-DD), type=sales|stock */
export const getHistory = async (req, res) => {
  const customer = await Customer.findById(req.params.id).lean();
  if (!customer) {
    return res.status(404).json({ success: false, message: 'Customer not found' });
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
  const saleMatch = { customerId: req.params.id };
  if (hasDateFilter) saleMatch.date = dateFilter;
  const stockMatch = customer.linkedSupplierId ? { supplierId: customer.linkedSupplierId } : null;
  if (stockMatch && hasDateFilter) stockMatch.date = dateFilter;

  const fetchSales = !type || type === 'sales';
  const fetchStock = (!type || type === 'stock') && customer.linkedSupplierId;

  const [sales, stockEntries] = await Promise.all([
    fetchSales
      ? Sale.find(saleMatch)
          .populate('itemId', 'name')
          .populate('accountId', 'name')
          .sort({ date: -1 })
          .limit(500)
          .lean()
      : [],
    fetchStock && stockMatch
      ? StockEntry.find(stockMatch)
          .populate('itemId', 'name')
          .sort({ date: -1 })
          .limit(500)
          .lean()
      : [],
  ]);
  const items = await Item.find({}).lean();
  const itemMap = new Map(items.map((i) => [i._id.toString(), i]));
  const salesWithPart = sales.map((s) => {
    const itemIdStr = (s.itemId && (s.itemId._id || s.itemId)) || s.itemId;
    const item = itemMap.get(itemIdStr.toString());
    const partIdStr = (s.partId && s.partId.toString) ? s.partId.toString() : String(s.partId);
    const part = (item?.parts || []).find((p) => p._id.toString() === partIdStr);
    return { ...s, partName: part?.partName, partUnit: part?.unit || 'kg' };
  });
  res.json({
    success: true,
    data: {
      name: customer.name,
      sales: salesWithPart,
      stockEntries,
      linkedSupplier: customer.linkedSupplierId ? { _id: customer.linkedSupplierId } : null,
    },
  });
};
