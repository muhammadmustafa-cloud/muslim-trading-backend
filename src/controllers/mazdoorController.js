import Mazdoor from '../models/Mazdoor.js';
import Transaction from '../models/Transaction.js';
import mongoose from 'mongoose';

export const list = async (req, res) => {
  const search = (req.query.search || '').trim();
  const filter = search ? { name: new RegExp(search, 'i') } : {};
  const mazdoor = await Mazdoor.find(filter).sort({ name: 1 }).lean();
  res.json({ success: true, data: mazdoor });
};

export const getById = async (req, res) => {
  const mazdoor = await Mazdoor.findById(req.params.id).lean();
  if (!mazdoor) {
    return res.status(404).json({ success: false, message: 'Mazdoor not found' });
  }
  res.json({ success: true, data: mazdoor });
};

export const create = async (req, res) => {
  const { name, phone, role, notes } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, message: 'Name is required' });
  }
  const mazdoor = await Mazdoor.create({
    name: name.trim(),
    phone: (phone || '').trim(),
    role: (role || '').trim(),
    notes: (notes || '').trim(),
  });
  res.status(201).json({ success: true, data: mazdoor });
};

export const update = async (req, res) => {
  if (req.body.name !== undefined && (!req.body.name || !String(req.body.name).trim())) {
    return res.status(400).json({ success: false, message: 'Name is required' });
  }
  const mazdoor = await Mazdoor.findByIdAndUpdate(
    req.params.id,
    {
      name: req.body.name?.trim(),
      phone: (req.body.phone ?? '').trim(),
      role: (req.body.role ?? '').trim(),
      notes: (req.body.notes ?? '').trim(),
    },
    { new: true, runValidators: true }
  ).lean();
  if (!mazdoor) {
    return res.status(404).json({ success: false, message: 'Mazdoor not found' });
  }
  res.json({ success: true, data: mazdoor });
};

export const remove = async (req, res) => {
  const deleted = await Mazdoor.findByIdAndDelete(req.params.id);
  if (!deleted) {
    return res.status(404).json({ success: false, message: 'Mazdoor not found' });
  }
  res.json({ success: true, message: 'Mazdoor deleted' });
};

/**
 * Mazdoor history: salary/udhaar diya (withdraw) + udhaar wapas liya (deposit with category udhaar_received).
 * Query: dateFrom, dateTo.
 */
export const getHistory = async (req, res) => {
  const mazdoor = await Mazdoor.findById(req.params.id).lean();
  if (!mazdoor) {
    return res.status(404).json({ success: false, message: 'Mazdoor not found' });
  }
  const { dateFrom, dateTo } = req.query;
  const filter = { mazdoorId: new mongoose.Types.ObjectId(req.params.id) };
  if (dateFrom || dateTo) {
    filter.date = {};
    if (dateFrom) filter.date.$gte = new Date(dateFrom);
    if (dateTo) {
      const d = new Date(dateTo);
      d.setHours(23, 59, 59, 999);
      filter.date.$lte = d;
    }
  }
  const transactions = await Transaction.find(filter)
    .populate('fromAccountId', 'name')
    .populate('toAccountId', 'name')
    .sort({ date: -1 })
    .limit(500)
    .lean();
  const totalPaid = transactions.filter((t) => t.type === 'withdraw').reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
  const totalReceived = transactions.filter((t) => t.type === 'deposit' && t.category === 'udhaar_received').reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
  res.json({
    success: true,
    data: {
      name: mazdoor.name,
      transactions,
      totalPaid,
      totalReceived,
    },
  });
};
