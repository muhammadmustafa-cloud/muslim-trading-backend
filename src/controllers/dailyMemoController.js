import Sale from '../models/Sale.js';
import StockEntry from '../models/StockEntry.js';
import Transaction from '../models/Transaction.js';
import MillExpense from '../models/MillExpense.js';
import MazdoorExpense from '../models/MazdoorExpense.js';
import Account from '../models/Account.js';
import Customer from '../models/Customer.js';
import Supplier from '../models/Supplier.js';
import Mazdoor from '../models/Mazdoor.js';
import mongoose from 'mongoose';

/**
 * Build date filter for a single day or range.
 */
function dateFilter(dateFrom, dateTo) {
  const filter = {};
  if (dateFrom || dateTo) {
    filter.date = {};
    if (dateFrom) filter.date.$gte = new Date(dateFrom);
    if (dateTo) {
      const d = new Date(dateTo);
      d.setHours(23, 59, 59, 999);
      filter.date.$lte = d;
    }
  }
  return filter;
}

/**
 * GET /api/daily-memo
 * Universal Daily Ledger — strictly follows CASH FLOW using the Transaction model.
 */
export const getDailyMemo = async (req, res) => {
  const { dateFrom, dateTo, accountId, customerId, supplierId, mazdoorId } = req.query;

  const todayStr = new Date().toISOString().slice(0, 10);
  const fromStr = dateFrom || todayStr;
  const toStr = dateTo || todayStr;

  const fromDate = new Date(fromStr);
  const toDate = new Date(toStr);
  toDate.setHours(23, 59, 59, 999);

  const prevMatch = { date: { $lt: fromDate }, type: { $ne: 'accrual' } };
  if (accountId) {
    const id = new mongoose.Types.ObjectId(accountId);
    prevMatch.$or = [{ fromAccountId: id }, { toAccountId: id }];
  }
  if (customerId) prevMatch.customerId = new mongoose.Types.ObjectId(customerId);
  if (supplierId) prevMatch.supplierId = new mongoose.Types.ObjectId(supplierId);
  if (mazdoorId) prevMatch.mazdoorId = new mongoose.Types.ObjectId(mazdoorId);

  // 1. Calculate Opening Balance (Carry Forward)
  let baseOpeningBalance = 0;
  if (accountId) {
    const acc = await Account.findById(accountId).lean();
    baseOpeningBalance = acc?.openingBalance || 0;
  } else if (customerId) {
    const cust = await Customer.findById(customerId).lean();
    baseOpeningBalance = cust?.openingBalance || 0;
  } else if (supplierId) {
    const sup = await Supplier.findById(supplierId).lean();
    baseOpeningBalance = sup?.openingBalance || 0;
  } else if (mazdoorId) {
    const maz = await Mazdoor.findById(mazdoorId).lean();
    baseOpeningBalance = maz?.openingBalance || 0;
  } else {
    const allAccs = await Account.find({}).lean();
    baseOpeningBalance = allAccs.reduce((sum, a) => sum + (a.openingBalance || 0), 0);
  }

  // Calculate Net Flow before fromDate
  const prevTransactions = await Transaction.aggregate([
    { $match: prevMatch },
    {
      $group: {
        _id: null,
        totalIn: { 
          $sum: { 
            $cond: [
              { $or: [
                { $and: [!!accountId, { $eq: ['$toAccountId', new mongoose.Types.ObjectId(accountId)] }] },
                { $and: [!accountId, !customerId && !supplierId && !mazdoorId, { $ne: ['$toAccountId', null] }] },
                { $and: [!!customerId, { $eq: ['$type', 'deposit'] }] },
                { $and: [!!supplierId, { $eq: ['$type', 'deposit'] }] },
                { $and: [!!mazdoorId, { $eq: ['$category', 'salary_accrual'] }] },
              ]}, 
              '$amount', 
              0 
            ] 
          } 
        },
        totalOut: { 
          $sum: { 
            $cond: [
              { $or: [
                { $and: [!!accountId, { $eq: ['$fromAccountId', new mongoose.Types.ObjectId(accountId)] }] },
                { $and: [!accountId, !customerId && !supplierId && !mazdoorId, { $ne: ['$fromAccountId', null] }] },
                { $and: [!!customerId, { $eq: ['$type', 'withdraw'] }] },
                { $and: [!!supplierId, { $eq: ['$type', 'withdraw'] }] },
                { $and: [!!mazdoorId, { $in: ['$type', ['withdraw', 'salary']] }] },
              ]}, 
              '$amount', 
              0 
            ] 
          } 
        },
      }
    }
  ]);

  const openingBalance = baseOpeningBalance + (prevTransactions.length > 0 
    ? (prevTransactions[0].totalIn - prevTransactions[0].totalOut) 
    : 0);

  const currMatch = {
    date: { $gte: fromDate, $lte: toDate },
    type: { $ne: 'accrual' }
  };
  if (accountId) {
    const id = new mongoose.Types.ObjectId(accountId);
    currMatch.$or = [{ fromAccountId: id }, { toAccountId: id }];
  }
  if (customerId) currMatch.customerId = new mongoose.Types.ObjectId(customerId);
  if (supplierId) currMatch.supplierId = new mongoose.Types.ObjectId(supplierId);
  if (mazdoorId) currMatch.mazdoorId = new mongoose.Types.ObjectId(mazdoorId);

  const transactions = await Transaction.find(currMatch)
    .populate('fromAccountId', 'name isDailyKhata isMillKhata')
    .populate('toAccountId', 'name isDailyKhata isMillKhata')
    .populate('supplierId', 'name')
    .populate('customerId', 'name')
    .populate('mazdoorId', 'name')
    .populate({
      path: 'saleId',
      select: 'truckNumber items itemName',
      populate: { path: 'items.itemId', select: 'name' }
    })
    .populate({
      path: 'stockEntryId',
      select: 'truckNumber items',
      populate: { path: 'items.itemId', select: 'name' }
    })
    .populate({
      path: 'machineryPurchaseId',
      populate: { path: 'machineryItemId', select: 'name' }
    })
    .populate('taxTypeId', 'name')
    .populate('expenseTypeId', 'name')
    .sort({ date: 1, createdAt: 1 })
    .lean();
  
  const isOperationalAccount = (acc) => !!(acc?.isDailyKhata || acc?.isMillKhata);
  const rows = [];

  transactions.forEach((t) => {
    const type = t.type;
    const category = t.category || '';
    let partyName = (t.customerId?.name || t.supplierId?.name || '');
    const hasParty = !!partyName;

    let desc = '';
    if (t.saleId) {
      const bill = t.saleId._id?.toString().slice(-6).toUpperCase() || '—';
      const itemNames = t.saleId.items?.length > 0 ? t.saleId.items.map(it => it.itemId?.name || 'Item').join(', ') : (t.saleId.itemName || 'Item');
      desc = `Sale — ${itemNames} (Bill: ${bill})`;
    } else if (t.stockEntryId) {
      const bill = t.stockEntryId._id?.toString().slice(-6).toUpperCase() || '—';
      const itemNames = t.stockEntryId.items?.length > 0 ? t.stockEntryId.items.map(it => it.itemId?.name || 'Item').join(', ') : 'Item';
      desc = `Purchase — ${itemNames} (Bill: ${bill})`;
    } else if (t.machineryPurchaseId) {
      desc = `Machinery — ${t.machineryPurchaseId.machineryItemId?.name || 'Part/Asset'}`;
    } else if (t.taxTypeId) desc = 'Tax Payment';
    else if (t.expenseTypeId) desc = 'General Expense';
    else if (category === 'mill_expense') desc = 'Mill Expense';
    else if (category === 'mazdoor_expense') desc = 'Mazdoor Expense';
    else desc = t.note || category.replace('_', ' ');

    let displayName = partyName;
    if (!displayName) {
      if (category === 'mill_expense') displayName = (t.note || '').replace(/^Mill:\s*/i, '') || 'Mill Expense';
      else if (category === 'mazdoor_expense') displayName = t.mazdoorId?.name ? `Mazdoor: ${t.mazdoorId.name}` : (t.note || 'Mazdoor Expense');
      else if (t.taxTypeId) displayName = t.taxTypeId.name || 'Tax Payment';
      else if (t.expenseTypeId) displayName = t.expenseTypeId.name || 'General Expense';
    }

    if (t.paymentMethod === 'cheque') desc += ` | Cheque #${t.chequeNumber || '—'}`;
    else if (t.paymentMethod === 'online') desc += ' | Online';

    if (type === 'deposit') {
      rows.push({ type: category || 'deposit', date: t.date, name: displayName, description: desc, accountName: t.toAccountId?.name || 'Manual', amount: t.amount, amountType: 'in', referenceId: t._id });
      if (hasParty && !isOperationalAccount(t.toAccountId)) {
        rows.push({ type: category || 'deposit', date: t.date, name: t.toAccountId?.name || 'Account', description: desc, accountName: displayName, amount: t.amount, amountType: 'out', referenceId: t._id });
      }
    } else if (['withdraw', 'salary', 'tax', 'expense'].includes(type)) {
      rows.push({ type: category || type, date: t.date, name: displayName, description: desc, accountName: t.fromAccountId?.name || 'Manual', amount: t.amount, amountType: 'out', referenceId: t._id });
      if (hasParty && !isOperationalAccount(t.fromAccountId)) {
        rows.push({ type: category || type, date: t.date, name: t.fromAccountId?.name || 'Account', description: desc, accountName: displayName, amount: t.amount, amountType: 'in', referenceId: t._id });
      }
    } else if (type === 'transfer') {
      rows.push({ type: 'transfer_out', date: t.date, name: t.fromAccountId?.name || 'Account', description: `Transfer to ${t.toAccountId?.name || '—'}`, accountName: t.fromAccountId?.name || 'Manual', amount: t.amount, amountType: 'out', referenceId: t._id });
      rows.push({ type: 'transfer_in', date: t.date, name: t.toAccountId?.name || 'Account', description: `Transfer from ${t.fromAccountId?.name || '—'}`, accountName: t.toAccountId?.name || 'Manual', amount: t.amount, amountType: 'in', referenceId: t._id });
    }
  });

  const todayIn = rows.filter(r => r.amountType === 'in').reduce((s, r) => s + r.amount, 0);
  const todayOut = rows.filter(r => r.amountType === 'out').reduce((s, r) => s + r.amount, 0);

  res.json({
    success: true,
    data: rows,
    summary: {
      openingBalance,
      totalIn: todayIn,
      totalOut: todayOut,
      net: todayIn - todayOut,
      closingBalance: openingBalance + todayIn - todayOut
    },
  });
};
