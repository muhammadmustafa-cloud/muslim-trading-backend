import Account from '../models/Account.js';
import { getAccountBalance } from './transactionController.js';

export const list = async (req, res) => {
  const search = (req.query.search || '').trim();
  const filter = search ? { name: new RegExp(search, 'i') } : {};
  const accounts = await Account.find(filter).sort({ name: 1 }).lean();
  const data = await Promise.all(
    accounts.map(async (a) => {
      const flow = await getAccountBalance(a._id);
      return {
        ...a,
        currentBalance: (a.openingBalance ?? 0) + flow,
      };
    })
  );
  res.json({ success: true, data });
};

export const getById = async (req, res) => {
  const account = await Account.findById(req.params.id).lean();
  if (!account) {
    return res.status(404).json({ success: false, message: 'Account not found' });
  }
  const flow = await getAccountBalance(account._id);
  res.json({
    success: true,
    data: { ...account, currentBalance: (account.openingBalance ?? 0) + flow },
  });
};

export const create = async (req, res) => {
  const { name, type, accountNumber, openingBalance, notes } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, message: 'Name is required' });
  }
  const account = await Account.create({
    name: name.trim(),
    type: type === 'Bank' ? 'Bank' : 'Cash',
    accountNumber: (accountNumber || '').trim(),
    openingBalance: Number(openingBalance) || 0,
    notes: (notes || '').trim(),
  });
  res.status(201).json({ success: true, data: account });
};

export const update = async (req, res) => {
  if (req.body.name !== undefined && (!req.body.name || !String(req.body.name).trim())) {
    return res.status(400).json({ success: false, message: 'Name is required' });
  }
  const account = await Account.findByIdAndUpdate(
    req.params.id,
    {
      name: req.body.name?.trim(),
      type: req.body.type === 'Bank' ? 'Bank' : 'Cash',
      accountNumber: (req.body.accountNumber ?? '').trim(),
      notes: (req.body.notes ?? '').trim(),
    },
    { new: true, runValidators: true }
  ).lean();
  if (!account) {
    return res.status(404).json({ success: false, message: 'Account not found' });
  }
  res.json({ success: true, data: account });
};

export const remove = async (req, res) => {
  const deleted = await Account.findByIdAndDelete(req.params.id);
  if (!deleted) {
    return res.status(404).json({ success: false, message: 'Account not found' });
  }
  res.json({ success: true, message: 'Account deleted' });
};
