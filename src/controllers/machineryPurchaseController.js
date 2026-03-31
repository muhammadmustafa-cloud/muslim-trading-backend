import MachineryPurchase from '../models/MachineryPurchase.js';
import Transaction from '../models/Transaction.js';
import mongoose from 'mongoose';

export const list = async (req, res) => {
  const { dateFrom, dateTo, machineryItemId, supplierId } = req.query;
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
  if (machineryItemId) filter.machineryItemId = new mongoose.Types.ObjectId(machineryItemId);
  if (supplierId) filter.supplierId = new mongoose.Types.ObjectId(supplierId);

  const entries = await MachineryPurchase.find(filter)
    .populate('machineryItemId', 'name quality')
    .populate('supplierId', 'name')
    .populate('accountId', 'name')
    .sort({ date: -1 })
    .lean();
  res.json({ success: true, data: entries });
};

export const create = async (req, res) => {
  const { date, machineryItemId, supplierId, accountId, amount, quantity, note } = req.body;
  if (!machineryItemId || !supplierId || !accountId || !amount) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  // 1. Create the Purchase Entry
  const purchase = await MachineryPurchase.create({
    // Force PKT Offset for string dates
    date: date 
      ? (typeof date === 'string' && date.length === 10 ? new Date(`${date}T00:00:00+05:00`) : new Date(date)) 
      : new Date(),
    machineryItemId,
    supplierId,
    accountId,
    amount: Number(amount),
    quantity: Number(quantity) || 1,
    note: (note || '').trim(),
  });

  // 2. Create Corresponding Financial Transaction (Debit account, link to supplier)
  const transaction = await Transaction.create({
    date: purchase.date,
    type: 'withdraw',
    fromAccountId: accountId,
    amount: purchase.amount,
    category: 'Machinery Purchase',
    note: (note || '').trim() || `Purchased machinery part(s)`,
    supplierId: supplierId,
    machineryPurchaseId: purchase._id
  });

  // Link transaction back to purchase
  purchase.transactionId = transaction._id;
  await purchase.save();

  const populated = await MachineryPurchase.findById(purchase._id)
    .populate('machineryItemId', 'name')
    .populate('supplierId', 'name')
    .populate('accountId', 'name')
    .lean();

  res.status(201).json({ success: true, data: populated });
};

export const remove = async (req, res) => {
  const purchase = await MachineryPurchase.findById(req.params.id);
  if (!purchase) return res.status(404).json({ success: false, message: 'Entry not found' });

  // Delete linked transaction
  if (purchase.transactionId) {
    await Transaction.findByIdAndDelete(purchase.transactionId);
  }

  await MachineryPurchase.findByIdAndDelete(req.params.id);
  res.json({ success: true, message: 'Deleted and corrected accounts' });
};
