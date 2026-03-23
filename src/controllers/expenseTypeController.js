import ExpenseType from '../models/ExpenseType.js';
import Transaction from '../models/Transaction.js';

export const list = async (req, res) => {
  try {
    const data = await ExpenseType.find().sort({ name: 1 }).lean();
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

export const create = async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Name is required' });
    
    const exists = await ExpenseType.findOne({ name: name.trim() });
    if (exists) return res.status(400).json({ success: false, message: 'Expense type already exists' });

    const data = await ExpenseType.create({ name: name.trim(), description: (description || '').trim() });
    res.status(201).json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

export const remove = async (req, res) => {
  try {
    const { id } = req.params;
    const linkedTx = await Transaction.findOne({ expenseTypeId: id });
    if (linkedTx) {
      return res.status(400).json({ success: false, message: 'Cannot delete expense type with existing transactions' });
    }
    await ExpenseType.findByIdAndDelete(id);
    res.json({ success: true, message: 'Expense type deleted' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

export const getLedger = async (req, res) => {
  try {
    const { id } = req.params;
    const { dateFrom, dateTo } = req.query;
    
    const expenseType = await ExpenseType.findById(id).lean();
    if (!expenseType) return res.status(404).json({ success: false, message: 'Expense type not found' });

    const query = { expenseTypeId: id };
    if (dateFrom || dateTo) {
      query.date = {};
      if (dateFrom) query.date.$gte = new Date(dateFrom);
      if (dateTo) {
        const d = new Date(dateTo);
        d.setHours(23, 59, 59, 999);
        query.date.$lte = d;
      }
    }

    const ledger = await Transaction.find(query)
      .sort({ date: -1, createdAt: -1 })
      .populate('fromAccountId', 'name type')
      .lean();

    const totalSpent = ledger.reduce((sum, tx) => sum + (tx.amount || 0), 0);

    res.json({
      success: true,
      data: {
        expenseType,
        ledger,
        totalSpent
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};
