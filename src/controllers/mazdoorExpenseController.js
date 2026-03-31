import MazdoorExpense from '../models/MazdoorExpense.js';
import MazdoorItem from '../models/MazdoorItem.js';
import Transaction from '../models/Transaction.js';
import { getAccountBalance } from './transactionController.js';
import mongoose from 'mongoose';

export const list = async (req, res) => {
  const { dateFrom, dateTo, mazdoorId } = req.query;
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
  if (mazdoorId) filter.mazdoorId = new mongoose.Types.ObjectId(mazdoorId);

  const expenses = await MazdoorExpense.find(filter)
    .populate('mazdoorId', 'name')
    .populate('mazdoorItemId', 'name rate')
    .populate('accountId', 'name')
    .sort({ date: -1 })
    .lean();
  res.json({ success: true, data: expenses });
};

export const create = async (req, res) => {
  const { date, mazdoorId, mazdoorItemId, bags, accountId } = req.body;
  if (!mazdoorId || !mazdoorItemId || bags == null || !accountId) {
    return res.status(400).json({
      success: false,
      message: 'mazdoorId, mazdoorItemId, bags and accountId are required',
    });
  }
  const bagsNum = Number(bags);
  if (isNaN(bagsNum) || bagsNum < 0) {
    return res.status(400).json({ success: false, message: 'bags must be a non-negative number' });
  }

  const item = await MazdoorItem.findById(mazdoorItemId).lean();
  if (!item) return res.status(400).json({ success: false, message: 'Mazdoor item not found' });

  const rate = Number(item.rate) || 0;
  const totalAmount = rate * bagsNum;

  if (totalAmount <= 0) {
    return res.status(400).json({ success: false, message: 'Total amount must be greater than 0 (check item rate and bags)' });
  }

  const Account = (await import('../models/Account.js')).default;
  const account = await Account.findById(accountId).lean();
  if (!account) return res.status(400).json({ success: false, message: 'Account not found' });
  const totalBalance = (account.openingBalance ?? 0) + (await getAccountBalance(accountId));
  if (totalBalance < totalAmount) {
    return res.status(400).json({
      success: false,
      message: `Insufficient balance. Available: ${totalBalance}`,
    });
  }

  const transaction = await Transaction.create({
    date: date ? (typeof date === 'string' && date.length === 10 ? new Date(`${date}T00:00:00+05:00`) : new Date(date)) : new Date(),
    type: 'withdraw',
    fromAccountId: accountId,
    toAccountId: null,
    amount: totalAmount,
    category: 'mazdoor_expense',
    note: `${item.name} × ${bagsNum} bag(s)`,
    mazdoorId,
  });

  const expense = await MazdoorExpense.create({
    date: date ? (typeof date === 'string' && date.length === 10 ? new Date(`${date}T00:00:00+05:00`) : new Date(date)) : new Date(),
    mazdoorId,
    mazdoorItemId,
    bags: bagsNum,
    totalAmount,
    accountId,
    transactionId: transaction._id,
  });

  const populated = await MazdoorExpense.findById(expense._id)
    .populate('mazdoorId', 'name')
    .populate('mazdoorItemId', 'name rate')
    .populate('accountId', 'name')
    .lean();
  res.status(201).json({ success: true, data: populated });
};

