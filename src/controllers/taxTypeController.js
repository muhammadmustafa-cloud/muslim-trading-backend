import TaxType from '../models/TaxType.js';
import Transaction from '../models/Transaction.js';
import { buildUTCDateFilter } from '../utils/dateUtils.js';

export const list = async (req, res) => {
  try {
    const data = await TaxType.find().sort({ name: 1 }).lean();
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

export const create = async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Name is required' });
    
    const exists = await TaxType.findOne({ name: name.trim() });
    if (exists) return res.status(400).json({ success: false, message: 'Tax type already exists' });

    const data = await TaxType.create({ name: name.trim(), description: description || '' });
    res.status(201).json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

export const remove = async (req, res) => {
  try {
    const { id } = req.params;
    const hasTransactions = await Transaction.exists({ taxTypeId: id });
    if (hasTransactions) {
      return res.status(400).json({ success: false, message: 'Cannot delete tax type with existing payments' });
    }
    await TaxType.findByIdAndDelete(id);
    res.json({ success: true, message: 'Tax type deleted' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

export const getLedger = async (req, res) => {
  try {
    const { id } = req.params;
    const { dateFrom, dateTo } = req.query;
    
    const taxType = await TaxType.findById(id).lean();
    if (!taxType) return res.status(404).json({ success: false, message: 'Tax type not found' });

    const filter = { taxTypeId: id, ...buildUTCDateFilter(dateFrom, dateTo) };

    const ledger = await Transaction.find(filter)
      .populate('fromAccountId', 'name')
      .sort({ date: -1 })
      .lean();

    const totalPaid = ledger.reduce((sum, t) => sum + (t.amount || 0), 0);

    res.json({
      success: true,
      data: {
        taxType,
        ledger,
        totalPaid
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};
