import MillExpense from '../models/MillExpense.js';
import Transaction from '../models/Transaction.js';
import Account from '../models/Account.js';
import { getAccountBalance } from './transactionController.js';
import mongoose from 'mongoose';

async function getOrCreateMillAccount() {
  let account = await Account.findOne({ isMillKhata: true }).lean();
  if (!account) {
    account = await Account.findOne({ name: /^Mill Khata$/i }).lean();
  }
  if (!account) {
    const created = await Account.create({ name: 'Mill Khata', type: 'Cash', isMillKhata: true });
    account = created.toObject();
  } else if (!account.isMillKhata) {
    await Account.findByIdAndUpdate(account._id, { isMillKhata: true });
    account = { ...account, isMillKhata: true };
  }
  return account;
}

export const list = async (req, res) => {
  const { dateFrom, dateTo, page = 1, limit = 10 } = req.query;
  const filter = {};
  if (dateFrom || dateTo) {
    filter.date = {};
    if (dateFrom) {
      filter.date.$gte = new Date(`${dateFrom}T00:00:00+05:00`);
    }
    if (dateTo) {
      filter.date.$lte = new Date(`${dateTo}T23:59:59.999+05:00`);
    }
  }

  const pageNum = parseInt(page, 10);
  const limitNum = parseInt(limit, 10);
  const skip = (pageNum - 1) * limitNum;

  const totalDocs = await MillExpense.countDocuments(filter);
  const expenses = await MillExpense.find(filter)
    .sort({ date: -1, createdAt: -1 })
    .skip(skip)
    .limit(limitNum)
    .lean();

  const allExpensesForTotal = await MillExpense.find(filter).lean();
  const total = allExpensesForTotal.reduce((s, e) => s + (Number(e.amount) || 0), 0);

  const account = await getOrCreateMillAccount();
  const flow = await getAccountBalance(account._id);
  const currentBalance = (account.openingBalance ?? 0) + flow;

  res.json({
    success: true,
    data: expenses,
    pagination: {
      total: totalDocs,
      page: pageNum,
      pages: Math.ceil(totalDocs / limitNum),
      limit: limitNum,
    },
    summary: { total, accountBalance: currentBalance },
    account: { _id: account._id, name: account.name },
  });
};

export const create = async (req, res) => {
  const { date, amount, category, note } = req.body;
  const amt = Number(amount);
  if (isNaN(amt) || amt <= 0) {
    return res.status(400).json({ success: false, message: 'Valid amount required' });
  }
  const account = await getOrCreateMillAccount();
  const balance = (account.openingBalance ?? 0) + (await getAccountBalance(account._id));
  if (balance < amt) {
    return res.status(400).json({ success: false, message: `Insufficient balance in Mill Khata. Available: ${balance}` });
  }

  const expense = await MillExpense.create({
    date: date ? (typeof date === 'string' && date.length === 10 ? new Date(`${date}T00:00:00+05:00`) : new Date(date)) : new Date(),
    amount: amt,
    category: (category || '').trim(),
    note: (note || '').trim(),
    image: req.file ? req.file.filename : null,
  });

  await Transaction.create({
    date: expense.date,
    type: 'withdraw',
    fromAccountId: account._id,
    toAccountId: null,
    amount: amt,
    category: 'mill_expense',
    note: (note || '').trim() ? `Mill: ${(note || '').trim()}` : `Mill expense — ${(category || 'Expense').trim()}`,
  });

  const populated = await MillExpense.findById(expense._id).lean();
  res.status(201).json({ success: true, data: populated });
};

