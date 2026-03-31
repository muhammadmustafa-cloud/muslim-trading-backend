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
  const mazdoor = await Mazdoor.findById(req.params.id).lean();
  if (!mazdoor) {
    return res.status(404).json({ success: false, message: 'Mazdoor not found' });
  }
  const { dateFrom, dateTo } = req.query;
  const mId = new mongoose.Types.ObjectId(req.params.id);
  
  const dateFilter = {};
  if (dateFrom || dateTo) {
    dateFilter.date = {};
    if (dateFrom) {
      dateFilter.date.$gte = new Date(`${dateFrom}T00:00:00+05:00`);
    }
    if (dateTo) {
      dateFilter.date.$lte = new Date(`${dateTo}T23:59:59.999+05:00`);
    }
  }

  // Transactions (Payments/Advances)
  const transactions = await Transaction.find({ mazdoorId: mId, ...dateFilter })
    .populate('fromAccountId', 'name')
    .populate('toAccountId', 'name')
    .sort({ date: -1 })
    .limit(1000)
    .lean();

  // Also include Daily Wage Earnings (from MazdoorExpense) if needed for "Total Earned"
  // Note: MazdoorExpense records work earn but also usually matches a "withdraw" transaction 
  // if paid immediately. To avoid double counting for "Total Paid", we use Transaction.
  
  const totalPaid = transactions.filter((t) => t.type === 'withdraw' || t.type === 'salary').reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
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
