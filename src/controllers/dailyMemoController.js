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
    if (dateFrom) {
      filter.date.$gte = new Date(`${dateFrom}T00:00:00+05:00`);
    }
    if (dateTo) {
      filter.date.$lte = new Date(`${dateTo}T23:59:59.999+05:00`);
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

  const todayStr = new Date().toLocaleString('en-CA', { timeZone: 'Asia/Karachi' }).slice(0, 10);
  const fromStr = dateFrom || todayStr;
  const toStr = dateTo || todayStr;

  const fromDate = new Date(`${fromStr}T00:00:00+05:00`);
  const toDate = new Date(`${toStr}T23:59:59.999+05:00`);

  const prevMatch = { date: { $lt: fromDate }, type: { $ne: 'accrual' } };
  if (accountId) {
    const id = new mongoose.Types.ObjectId(accountId);
    prevMatch.$or = [{ fromAccountId: id }, { toAccountId: id }];
  }
  if (customerId) prevMatch.customerId = new mongoose.Types.ObjectId(customerId);
  if (supplierId) prevMatch.supplierId = new mongoose.Types.ObjectId(supplierId);
  if (mazdoorId) prevMatch.mazdoorId = new mongoose.Types.ObjectId(mazdoorId);

  // 1. Identify "Mill Accounts" (Daily & Mill Khata)
  const allMillAccs = await Account.find({ $or: [{ isDailyKhata: true }, { isMillKhata: true }] }).lean();
  const millAccIds = allMillAccs.map(a => a._id.toString());
  const millAccObjectIdIds = allMillAccs.map(a => a._id);

  // 1. Calculate Base Opening Balance
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
    // Full Mill Summary — sum all mill accounts' opening balances
    baseOpeningBalance = allMillAccs.reduce((sum, a) => sum + (a.openingBalance || 0), 0);
  }

  // 2. Calculate Historical Cash Flow
  // We determine what entered/left the "Mill Box" before today.
  const prevTransactions = await Transaction.aggregate([
    { $match: prevMatch },
    {
      $group: {
        _id: null,
        totalIn: { 
          $sum: { 
            $cond: [
              { $or: [
                // Case A: Specific Account selected + Source=Credit logic
                { $and: [!!accountId, { $ne: ['$type', 'transfer'] }, { $eq: ['$toAccountId', new mongoose.Types.ObjectId(accountId)] }] },
                { $and: [!!accountId, { $eq: ['$type', 'transfer'] }, { $eq: ['$fromAccountId', new mongoose.Types.ObjectId(accountId)] }] },
                // Case B: Full Mill Summary + money entered ANY Mill Account
                // (Note: Internal transfers cancel out mathematically in Full Mill view)
                { $and: [!accountId, !customerId && !supplierId && !mazdoorId, { $in: ['$toAccountId', millAccObjectIdIds] }] },
                // Case C: Party ledgers
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
                // Case A: Specific Account selected + Destination=Debit logic
                { $and: [!!accountId, { $ne: ['$type', 'transfer'] }, { $eq: ['$fromAccountId', new mongoose.Types.ObjectId(accountId)] }] },
                { $and: [!!accountId, { $eq: ['$type', 'transfer'] }, { $eq: ['$toAccountId', new mongoose.Types.ObjectId(accountId)] }] },
                // Case B: Full Mill Summary + money left ANY Mill Account
                { $and: [!accountId, !customerId && !supplierId && !mazdoorId, { $in: ['$fromAccountId', millAccObjectIdIds] }] },
                // Case C: Party ledgers
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
    .populate('fromAccountId', 'name type isDailyKhata isMillKhata')
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
    .populate('rawMaterialHeadId', 'name')
    .sort({ date: 1, createdAt: 1 })
    .lean();
  
  const isOperationalAccount = (acc) => !!(acc?.isDailyKhata || acc?.isMillKhata);
  const isInternalTransfer = (t) => t.type === 'transfer' && isOperationalAccount(t.fromAccountId) && isOperationalAccount(t.toAccountId);
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
    else if (t.rawMaterialHeadId) desc = `Raw Material — ${t.rawMaterialHeadId.name || 'Item'}`;
    else if (category === 'mill_expense') desc = 'Mill Expense';
    else if (category === 'mazdoor_expense') desc = 'Mazdoor Expense';
    else desc = t.note || category.replace('_', ' ');

    let displayName = partyName;
    if (!displayName) {
      if (category === 'mill_expense') displayName = (t.note || '').replace(/^Mill:\s*/i, '') || 'Mill Expense';
      else if (category === 'mazdoor_expense') displayName = t.mazdoorId?.name ? `Mazdoor: ${t.mazdoorId.name}` : (t.note || 'Mazdoor Expense');
      else if (t.mazdoorId) displayName = t.mazdoorId.name || 'Mazdoor';
      else if (t.taxTypeId) displayName = t.taxTypeId.name || 'Tax Payment';
      else if (t.expenseTypeId) displayName = t.expenseTypeId.name || 'General Expense';
      else if (t.rawMaterialHeadId) displayName = t.rawMaterialHeadId.name || 'Raw Material';
    }

    if (t.paymentMethod === 'cheque') desc += ` | Cheque #${t.chequeNumber || '—'}`;
    else if (t.paymentMethod === 'online') desc += ' | Online';

    // Track "Master Totals" only for external cash flow
    const isExternal = !isInternalTransfer(t);

    if (type === 'deposit') {
      const isBankDest = t.toAccountId?.type === 'Bank';
      const accountAmountType = isBankDest ? 'out' : 'in'; // Bank Deposit = Money leaving box (Kharch), Cash Deposit = Aamad
      const partyAmountType = isBankDest ? 'in' : 'out'; // If giving to bank (Kharch), the "Source" is Aamad? No, usually symmetric.

      // 1. Primary Move: Money enters the Account (Credit/Aamad from Shop perspective)
      rows.push({ 
        type: category || 'deposit', 
        date: t.date, 
        name: t.toAccountId?.name || 'Account', 
        description: desc, 
        accountName: displayName || 'Manual', 
        amount: t.amount, 
        amountType: accountAmountType, 
        isExternal, 
        referenceId: t._id 
      });

      // 2. Contra Move: Money received from Participant (Debit/Kharch) - ONLY if participant exists
      if (hasParty) {
        rows.push({ 
          type: category || 'deposit', 
          date: t.date, 
          name: displayName, 
          description: desc, 
          accountName: t.toAccountId?.name || 'Manual', 
          amount: t.amount, 
          amountType: isBankDest ? 'in' : 'out', 
          isExternal, 
          referenceId: t._id 
        });
      }
    } else if (['withdraw', 'salary', 'tax', 'expense'].includes(type)) {
      const isBankSource = t.fromAccountId?.type === 'Bank';

      // 1. Primary Move: Money leaves the Account (Debit/Kharch from Shop perspective)
      rows.push({ 
        type: category || type, 
        date: t.date, 
        name: t.fromAccountId?.name || 'Account', 
        description: desc, 
        accountName: displayName || 'Manual', 
        amount: t.amount, 
        amountType: 'out', // Account pays = Kharch (Debit side)
        isExternal, 
        referenceId: t._id 
      });

      // 2. Contra Move (Aamne-Samne): opposite side of the transaction
      // For Cash/Mill accounts: only when customer/supplier party exists (existing behavior)
      // For Bank accounts: always generate contra for Tax/Expense/Salary/Mazdoor
      const shouldContra = hasParty || (isBankSource && displayName);
      if (shouldContra) {
        rows.push({ 
          type: category || type, 
          date: t.date, 
          name: displayName, 
          description: desc, 
          accountName: t.fromAccountId?.name || 'Manual', 
          amount: t.amount, 
          amountType: 'in', // Recipient receives = Aamad (Credit side)
          isExternal, 
          referenceId: t._id 
        });
      }
    } else if (type === 'transfer') {
      // Internal transfers always show Aamne-Samne (Source=In/Aamad, Destination=Out/Kharch)
      rows.push({ type: 'transfer_out', date: t.date, name: t.fromAccountId?.name || 'Account', description: `Transfer to ${t.toAccountId?.name || '—'}`, accountName: t.fromAccountId?.name || 'Manual', amount: t.amount, amountType: 'in', isExternal, referenceId: t._id });
      rows.push({ type: 'transfer_in', date: t.date, name: t.toAccountId?.name || 'Account', description: `Transfer from ${t.fromAccountId?.name || '—'}`, accountName: t.toAccountId?.name || 'Manual', amount: t.amount, amountType: 'out', isExternal, referenceId: t._id });
    }
  });

  // Calculate clean summary excluding internal loop-backs
  const todayIn = rows.filter(r => r.amountType === 'in' && r.isExternal).reduce((s, r) => s + r.amount, 0);
  const todayOut = rows.filter(r => r.amountType === 'out' && r.isExternal).reduce((s, r) => s + r.amount, 0);

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
