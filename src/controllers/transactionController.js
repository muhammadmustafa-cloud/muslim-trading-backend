import Transaction from '../models/Transaction.js';
import Sale from '../models/Sale.js';
import mongoose from 'mongoose';

/**
 * Returns net flow for account: (sales + deposits in + transfers in) − (withdrawals + transfers out).
 * Full balance = openingBalance + getAccountBalance(accountId).
 */
async function getAccountBalance(accountId) {
  if (!accountId) return 0;
  const id = new mongoose.Types.ObjectId(accountId);
  const [salesResult, depositIn, transferIn, withdrawOut, transferOut] = await Promise.all([
    Sale.aggregate([{ $match: { accountId: id } }, { $group: { _id: null, total: { $sum: '$amountReceived' } } }]),
    Transaction.aggregate([{ $match: { type: 'deposit', toAccountId: id } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
    Transaction.aggregate([{ $match: { type: 'transfer', toAccountId: id } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
    Transaction.aggregate([{ $match: { type: 'withdraw', fromAccountId: id } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
    Transaction.aggregate([{ $match: { type: 'transfer', fromAccountId: id } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
  ]);
  const credits = (salesResult[0]?.total ?? 0) + (depositIn[0]?.total ?? 0) + (transferIn[0]?.total ?? 0);
  const debits = (withdrawOut[0]?.total ?? 0) + (transferOut[0]?.total ?? 0);
  return credits - debits;
}

export const list = async (req, res) => {
  const { accountId, dateFrom, dateTo } = req.query;
  const filter = {};
  if (accountId) {
    const id = new mongoose.Types.ObjectId(accountId);
    filter.$or = [
      { fromAccountId: id },
      { toAccountId: id },
    ];
  }
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
    .populate('supplierId', 'name')
    .populate('mazdoorId', 'name')
    .sort({ date: -1 })
    .lean();
  res.json({ success: true, data: transactions });
};

export const create = async (req, res) => {
  const { type, fromAccountId, toAccountId, amount, category, note, supplierId, mazdoorId, date } = req.body;
  if (!type || !['deposit', 'withdraw', 'transfer'].includes(type)) {
    return res.status(400).json({ success: false, message: 'type must be deposit, withdraw, or transfer' });
  }
  const amt = Number(amount);
  if (isNaN(amt) || amt <= 0) {
    return res.status(400).json({ success: false, message: 'amount must be a positive number' });
  }

  if (type === 'deposit') {
    if (!toAccountId) return res.status(400).json({ success: false, message: 'toAccountId required for deposit' });
  }
  const Account = (await import('../models/Account.js')).default;
  if (type === 'withdraw') {
    if (!fromAccountId) return res.status(400).json({ success: false, message: 'fromAccountId required for withdraw' });
    const account = await Account.findById(fromAccountId).lean();
    const totalBalance = (account?.openingBalance ?? 0) + (await getAccountBalance(fromAccountId));
    if (totalBalance < amt) {
      return res.status(400).json({ success: false, message: `Insufficient balance. Available: ${totalBalance}` });
    }
  }
  if (type === 'transfer') {
    if (!fromAccountId || !toAccountId) return res.status(400).json({ success: false, message: 'fromAccountId and toAccountId required for transfer' });
    if (fromAccountId === toAccountId) return res.status(400).json({ success: false, message: 'Cannot transfer to same account' });
    const account = await Account.findById(fromAccountId).lean();
    const totalBalance = (account?.openingBalance ?? 0) + (await getAccountBalance(fromAccountId));
    if (totalBalance < amt) {
      return res.status(400).json({ success: false, message: `Insufficient balance. Available: ${totalBalance}` });
    }
  }

  const transaction = await Transaction.create({
    date: date ? new Date(date) : new Date(),
    type,
    fromAccountId: fromAccountId || null,
    toAccountId: toAccountId || null,
    amount: amt,
    category: (category || '').trim(),
    note: (note || '').trim(),
    supplierId: supplierId || null,
    mazdoorId: mazdoorId || null,
  });

  const populated = await Transaction.findById(transaction._id)
    .populate('fromAccountId', 'name')
    .populate('toAccountId', 'name')
    .populate('supplierId', 'name')
    .populate('mazdoorId', 'name')
    .lean();
  res.status(201).json({ success: true, data: populated });
};

export const getById = async (req, res) => {
  const transaction = await Transaction.findById(req.params.id)
    .populate('fromAccountId', 'name')
    .populate('toAccountId', 'name')
    .populate('supplierId', 'name')
    .populate('mazdoorId', 'name')
    .lean();
  if (!transaction) {
    return res.status(404).json({ success: false, message: 'Transaction not found' });
  }
  res.json({ success: true, data: transaction });
};

export const remove = async (req, res) => {
  const deleted = await Transaction.findByIdAndDelete(req.params.id);
  if (!deleted) {
    return res.status(404).json({ success: false, message: 'Transaction not found' });
  }
  res.json({ success: true, message: 'Transaction deleted' });
};

export { getAccountBalance };
