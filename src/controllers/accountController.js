import { getAccountBalance } from './transactionController.js';

export const list = async (req, res) => {
  const { Account, Transaction } = req.models;
  const search = (req.query.search || '').trim();
  const filter = search ? { name: new RegExp(search, 'i') } : {};
  const accounts = await Account.find(filter).sort({ name: 1 }).lean();
  const data = await Promise.all(
    accounts.map(async (a) => {
      const flow = await getAccountBalance(Transaction, a._id);
      return {
        ...a,
        currentBalance: (a.openingBalance ?? 0) + flow,
      };
    })
  );
  res.json({ success: true, data });
};

export const getById = async (req, res) => {
  const { Account, Transaction } = req.models;
  const account = await Account.findById(req.params.id).lean();
  if (!account) {
    return res.status(404).json({ success: false, message: 'Account not found' });
  }
  const flow = await getAccountBalance(Transaction, account._id);
  res.json({
    success: true,
    data: { ...account, currentBalance: (account.openingBalance ?? 0) + flow },
  });
};

export const create = async (req, res) => {
  const { Account } = req.models;
  const { name, type, accountNumber, openingBalance, notes, showMirrorInDailyMemo } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, message: 'Name is required' });
  }
  const account = await Account.create({
    name: name.trim(),
    type: type === 'Bank' ? 'Bank' : 'Cash',
    accountNumber: (accountNumber || '').trim(),
    openingBalance: Number(openingBalance) || 0,
    notes: (notes || '').trim(),
    showMirrorInDailyMemo: showMirrorInDailyMemo !== undefined ? showMirrorInDailyMemo : true,
  });
  res.status(201).json({ success: true, data: account });
};

export const update = async (req, res) => {
  const { Account } = req.models;
  if (req.body.name !== undefined && (!req.body.name || !String(req.body.name).trim())) {
    return res.status(400).json({ success: false, message: 'Name is required' });
  }
  const updateFields = {
    name: req.body.name?.trim(),
    type: req.body.type === 'Bank' ? 'Bank' : 'Cash',
    accountNumber: (req.body.accountNumber ?? '').trim(),
    notes: (req.body.notes ?? '').trim(),
  };
  if (req.body.openingBalance !== undefined && req.body.openingBalance !== null) {
    updateFields.openingBalance = Number(req.body.openingBalance) || 0;
  }
  if (req.body.showMirrorInDailyMemo !== undefined) {
    updateFields.showMirrorInDailyMemo = !!req.body.showMirrorInDailyMemo;
  }
  const account = await Account.findByIdAndUpdate(
    req.params.id,
    updateFields,
    { new: true, runValidators: true }
  ).lean();
  if (!account) {
    return res.status(404).json({ success: false, message: 'Account not found' });
  }
  res.json({ success: true, data: account });
};


/** GET /accounts/daily-khata — returns the account marked as Daily Khata (or null) */
export const getDailyKhataAccount = async (req, res) => {
  const { Account, Transaction } = req.models;
  const account = await Account.findOne({ isDailyKhata: true }).lean();
  if (!account) {
    return res.json({ success: true, data: null });
  }
  const flow = await getAccountBalance(Transaction, account._id);
  res.json({ success: true, data: { ...account, currentBalance: (account.openingBalance ?? 0) + flow } });
};

/** PUT /accounts/daily-khata — set which account is Daily Khata. Body: { accountId } */
export const setDailyKhataAccount = async (req, res) => {
  const { Account, Transaction } = req.models;
  const { accountId } = req.body;
  await Account.updateMany({}, { $set: { isDailyKhata: false } });
  if (accountId) {
    const account = await Account.findByIdAndUpdate(accountId, { isDailyKhata: true }, { new: true }).lean();
    if (!account) return res.status(404).json({ success: false, message: 'Account not found' });
    const flow = await getAccountBalance(Transaction, account._id);
    return res.json({ success: true, data: { ...account, currentBalance: (account.openingBalance ?? 0) + flow } });
  }
  res.json({ success: true, data: null });
};

const MILL_KHATA_ACCOUNT_NAME = 'Mill Khata';

/** GET /accounts/mill-khata — returns or creates the Mill Khata account */
export const getOrCreateMillKhataAccount = async (req, res) => {
  const { Account, Transaction } = req.models;
  let account = await Account.findOne({ isMillKhata: true }).lean();
  if (!account) {
    account = await Account.findOne({ name: new RegExp(`^${MILL_KHATA_ACCOUNT_NAME}$`, 'i') }).lean();
  }
  if (!account) {
    account = await Account.create({
      name: MILL_KHATA_ACCOUNT_NAME,
      type: 'Cash',
      isMillKhata: true,
    });
    account = account.toObject();
  } else if (!account.isMillKhata) {
    await Account.findByIdAndUpdate(account._id, { isMillKhata: true });
    account = { ...account, isMillKhata: true };
  }
  const flow = await getAccountBalance(Transaction, account._id);
  res.json({ success: true, data: { ...account, currentBalance: (account.openingBalance ?? 0) + flow } });
};
