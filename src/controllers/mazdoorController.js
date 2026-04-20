import mongoose from 'mongoose';
import { buildUTCDateFilter } from '../utils/dateUtils.js';

export const list = async (req, res) => {
  const { Mazdoor } = req.models;
  const search = (req.query.search || '').trim();
  const filter = search ? { name: new RegExp(search, 'i') } : {};
  const mazdoor = await Mazdoor.find(filter).sort({ name: 1 }).lean();
  res.json({ success: true, data: mazdoor });
};

export const getById = async (req, res) => {
  const { Mazdoor } = req.models;
  const mazdoor = await Mazdoor.findById(req.params.id).lean();
  if (!mazdoor) {
    return res.status(404).json({ success: false, message: 'Mazdoor not found' });
  }
  res.json({ success: true, data: mazdoor });
};

export const create = async (req, res) => {
  const { Mazdoor } = req.models;
  const { name, phone, role, notes, monthlySalary } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, message: 'Name is required' });
  }
  const mazdoor = await Mazdoor.create({
    name: name.trim(),
    phone: (phone || '').trim(),
    role: (role || '').trim(),
    notes: (notes || '').trim(),
    monthlySalary: Number(monthlySalary) || 0,
  });
  res.status(201).json({ success: true, data: mazdoor });
};

export const update = async (req, res) => {
  const { Mazdoor } = req.models;
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
      monthlySalary: req.body.monthlySalary !== undefined ? Number(req.body.monthlySalary) || 0 : undefined,
    },
    { new: true, runValidators: true }
  ).lean();
  if (!mazdoor) {
    return res.status(404).json({ success: false, message: 'Mazdoor not found' });
  }
  res.json({ success: true, data: mazdoor });
};


/**
 * Mazdoor history: salary/udhaar diya (withdraw) + udhaar wapas liya (deposit with category udhaar_received).
 * Query: dateFrom, dateTo.
 */
export const getHistory = async (req, res) => {
  const { Mazdoor, Transaction } = req.models;
  const mazdoor = await Mazdoor.findById(req.params.id).lean();
  if (!mazdoor) {
    return res.status(404).json({ success: false, message: 'Mazdoor not found' });
  }
  const { dateFrom, dateTo } = req.query;
  const mId = new mongoose.Types.ObjectId(req.params.id);
  
  const dateFilter = buildUTCDateFilter(dateFrom, dateTo);

  // Transactions (Payments/Advances)
  const transactions = await Transaction.find({ mazdoorId: mId, ...dateFilter })
    .populate('fromAccountId', 'name')
    .populate('toAccountId', 'name')
    .sort({ date: 1 }) // Oldest first (ascending)
    .limit(1000)
    .lean();
  
  const totalPaid = transactions.filter((t) => t.type === 'withdraw' || t.type === 'salary' || t.type === 'transfer').reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
  const totalReceived = transactions.filter((t) => t.type === 'deposit' && t.category === 'udhaar_received').reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
  
  // Salary Accruals + Daily Wages (Credits)
  const totalEarned = transactions
    .filter((t) => t.category === 'salary_accrual' || t.category === 'mazdoor_expense')
    .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
  
  res.json({
    success: true,
    data: {
      name: mazdoor.name,
      monthlySalary: mazdoor.monthlySalary || 0,
      transactions,
      totalPaid,
      totalReceived,
      totalEarned,
      balance: totalEarned - (totalPaid - totalReceived),
    },
  });
};
