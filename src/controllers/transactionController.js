import mongoose from 'mongoose';
import { toUTCStartOfDay, toUTCEndOfDay, buildUTCDateFilter } from '../utils/dateUtils.js';

/**
 * Returns net flow for account: (sales + deposits in + transfers in) − (withdrawals + transfers out).
 * Full balance = openingBalance + getAccountBalance(TransactionModel, accountId).
 */
async function getAccountBalance(Transaction, accountId, asOfDate) {
  if (!accountId) return 0;
  const id = new mongoose.Types.ObjectId(accountId);
  
  // Professional Fix: Ensure asOfDate is interpreted as UTC End-of-Day
  let boundaryDate = null;
  if (asOfDate) {
    if (typeof asOfDate === 'string' && asOfDate.length === 10) {
      boundaryDate = toUTCEndOfDay(asOfDate);
    } else {
      // If it's already a Date object, ensure it's treated accurately
      boundaryDate = new Date(asOfDate);
    }
  }
  
  const dateMatch = boundaryDate ? { date: { $lte: boundaryDate }, type: { $ne: 'accrual' } } : { type: { $ne: 'accrual' } };

  const [inflows, outflows] = await Promise.all([
    Transaction.aggregate([{ $match: { ...dateMatch, toAccountId: id } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
    Transaction.aggregate([{ $match: { ...dateMatch, fromAccountId: id } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
  ]);
  
  const totalIn = inflows[0]?.total ?? 0;
  const totalOut = outflows[0]?.total ?? 0;
  
  return totalIn - totalOut;
}

/**
 * Build date filter object for query.
 */
/**
 * Build date filter object for query.
 * Professional Fix: Forcing UTC boundaries for all date strings.
 */
function buildDateFilter(dateFrom, dateTo) {
  return buildUTCDateFilter(dateFrom, dateTo);
}


export const list = async (req, res) => {
  const { Transaction, Sale, StockEntry } = req.models;
  const { accountId, dateFrom, dateTo, mazdoorId, mazdoorOnly, unified, rawMaterialHeadId, page = 1, limit = 10, sortKey = 'date', sortDir = 'desc', export: isExport, isSignatureBook } = req.query;
  const includeSalesAndStock = unified === 'true' || unified === '1';

  // Pagination & Sorting setup
  const skip = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
  const sortDirection = sortDir === 'asc' ? 1 : -1;
  const sortStage = { $sort: { [sortKey]: sortDirection, _id: sortDirection } };

  const id = accountId ? new mongoose.Types.ObjectId(accountId) : null;
  const dateF = buildDateFilter(dateFrom, dateTo);

  if (includeSalesAndStock) {
    const transMatch = { ...dateF, type: { $ne: 'accrual' } };
    if (id) transMatch.$or = [{ fromAccountId: id }, { toAccountId: id }];
    if (mazdoorId) transMatch.mazdoorId = new mongoose.Types.ObjectId(mazdoorId);
    else if (mazdoorOnly === 'true' || mazdoorOnly === true) transMatch.mazdoorId = { $ne: null };
    if (rawMaterialHeadId) transMatch.rawMaterialHeadId = new mongoose.Types.ObjectId(rawMaterialHeadId);
    if (isSignatureBook === 'true') transMatch.isSignatureBook = true;

    const pipeline = [
      { $match: transMatch },
      { $project: {
          date: 1, type: 1, fromAccountId: 1, toAccountId: 1, amount: 1,
          category: 1, note: 1, source: { $literal: 'transaction' },
          referenceId: '$_id', supplierId: 1, customerId: 1, mazdoorId: 1,
          stockEntryId: 1, saleId: 1, machineryPurchaseId: 1,
          taxTypeId: 1, expenseTypeId: 1, rawMaterialHeadId: 1,
          isSignatureBook: 1, paymentMethod: 1, chequeNumber: 1, chequeDate: 1,
          image: 1, images: 1
      } }
    ];

    if (!rawMaterialHeadId) {
      const saleMatch = { ...dateF, amountReceived: { $gt: 0 } };
      if (id) saleMatch.accountId = id;
      pipeline.push({
        $unionWith: {
          coll: Sale.collection.name,
          pipeline: [
            { $match: saleMatch },
            { $project: {
                _id: { $concat: ["sale-", { $toString: "$_id" }] },
                date: 1, type: { $literal: 'sale' }, fromAccountId: { $literal: null },
                toAccountId: '$accountId', amount: '$amountReceived',
                category: { $literal: 'Sale' }, source: { $literal: 'sale' },
                referenceId: '$_id', customerId: 1, notes: 1, items: 1, itemId: 1,
                image: 1, images: 1
            } }
          ]
        }
      });

      const stockMatch = { ...dateF, $or: [{ amountPaid: { $gt: 0 } }, { amount: { $gt: 0 } }] };
      if (id) stockMatch.accountId = id;
      pipeline.push({
        $unionWith: {
          coll: StockEntry.collection.name,
          pipeline: [
            { $match: stockMatch },
            { $project: {
                _id: { $concat: ["stock-", { $toString: "$_id" }] },
                date: 1, type: { $literal: 'purchase' }, fromAccountId: '$accountId',
                toAccountId: { $literal: null },
                amount: { $cond: [{ $gt: ["$amountPaid", 0] }, "$amountPaid", "$amount"] },
                category: { $literal: 'Purchase' }, source: { $literal: 'stock_entry' },
                referenceId: '$_id', supplierId: 1, notes: 1, items: 1, itemId: 1,
                image: 1, images: 1
            } }
          ]
        }
      });
    }

    pipeline.push(sortStage);

    const facetStage = {
      $facet: {
        metadata: [{ $count: "total" }],
        data: []
      }
    };
    if (isExport !== 'true' && isExport !== true) {
      facetStage.$facet.data.push({ $skip: skip });
      facetStage.$facet.data.push({ $limit: parseInt(limit) });
    }
    pipeline.push(facetStage);

    const [result] = await Transaction.aggregate(pipeline);
    const totalCount = result.metadata[0]?.total || 0;
    let data = result.data || [];

    await Transaction.populate(data, [
      { path: 'fromAccountId', select: 'name' },
      { path: 'toAccountId', select: 'name' },
      { path: 'supplierId', select: 'name' },
      { path: 'customerId', select: 'name' },
      { path: 'mazdoorId', select: 'name' },
      { path: 'taxTypeId', select: 'name' },
      { path: 'expenseTypeId', select: 'name' },
      { path: 'rawMaterialHeadId', select: 'name' },
      { path: 'stockEntryId' },
      { path: 'saleId' },
      { path: 'machineryPurchaseId', populate: { path: 'machineryItemId', select: 'name' } },
      { path: 'items.itemId', select: 'name', model: 'Item' },
      { path: 'itemId', select: 'name', model: 'Item' }
    ]);

    const rows = data.map(doc => {
      const row = { ...doc };
      
      row.supplierName = row.supplierId?.name || '';
      row.customerName = row.customerId?.name || '';
      row.mazdoorName = row.mazdoorId?.name || '';
      row.taxTypeName = row.taxTypeId?.name || '';
      row.expenseTypeName = row.expenseTypeId?.name || '';
      row.rawMaterialHeadName = row.rawMaterialHeadId?.name || '';

      if (row.source === 'sale') {
        row.note = (row.notes || '').trim() || (row.customerName ? `Customer: ${row.customerName}` : '');
        row.itemName = (row.items && row.items.length > 0) ? row.items.map(it => it.itemId?.name || 'Item').join(', ') : (row.itemId?.name || 'Item');
      } else if (row.source === 'stock_entry') {
        row.note = (row.notes || '').trim() || (row.supplierName ? `Supplier: ${row.supplierName}` : '');
        row.itemName = (row.items && row.items.length > 0) ? row.items.map(it => it.itemId?.name || 'Item').join(', ') : (row.itemId?.name || 'Item');
      }

      delete row.notes;
      delete row.items;
      delete row.itemId;
      
      return row;
    });

    return res.json({ success: true, data: rows, totalCount });
  }

  // Non-unified branch
  const filter = { type: { $ne: 'accrual' }, ...dateF };
  if (id) filter.$or = [{ fromAccountId: id }, { toAccountId: id }];
  if (mazdoorId) filter.mazdoorId = new mongoose.Types.ObjectId(mazdoorId);
  else if (mazdoorOnly === 'true' || mazdoorOnly === true) filter.mazdoorId = { $ne: null };
  if (rawMaterialHeadId) filter.rawMaterialHeadId = new mongoose.Types.ObjectId(rawMaterialHeadId);
  if (isSignatureBook === 'true') filter.isSignatureBook = true;

  const totalCount = await Transaction.countDocuments(filter);
  let query = Transaction.find(filter)
    .populate('fromAccountId', 'name')
    .populate('toAccountId', 'name')
    .populate('supplierId', 'name')
    .populate('customerId', 'name')
    .populate('mazdoorId', 'name')
    .populate('stockEntryId')
    .populate('saleId')
    .populate('taxTypeId', 'name')
    .populate('expenseTypeId', 'name')
    .populate('rawMaterialHeadId', 'name')
    .populate({ path: 'machineryPurchaseId', populate: { path: 'machineryItemId', select: 'name' } })
    .sort({ [sortKey]: sortDirection, _id: sortDirection })
    .lean();

  if (isExport !== 'true' && isExport !== true) {
    query = query.skip(skip).limit(parseInt(limit));
  }
  
  const transactions = await query;
  res.json({ success: true, data: transactions, totalCount });
};

export const create = async (req, res) => {
  const { Transaction } = req.models;
  const { type, fromAccountId, toAccountId, amount, category, note, supplierId, customerId, mazdoorId, machineryPurchaseId, taxTypeId, expenseTypeId, rawMaterialHeadId, date, paymentMethod, chequeNumber, chequeDate, isSignatureBook } = req.body;
  if (!type || !['deposit', 'withdraw', 'transfer', 'accrual', 'salary', 'tax', 'expense'].includes(type)) {
    return res.status(400).json({ success: false, message: 'type must be deposit, withdraw, transfer, accrual, salary, tax, or expense' });
  }
  const amt = Number(amount);
  if (isNaN(amt) || amt <= 0) {
    return res.status(400).json({ success: false, message: 'amount must be a positive number' });
  }

  if (type === 'deposit') {
    if (!toAccountId) return res.status(400).json({ success: false, message: 'toAccountId required for deposit' });
  }
  if (type === 'withdraw' || type === 'salary' || type === 'tax' || type === 'expense') {
    if (!fromAccountId) return res.status(400).json({ success: false, message: `fromAccountId required for ${type}` });
    if (type === 'tax' && !taxTypeId) return res.status(400).json({ success: false, message: 'taxTypeId required for tax payment' });
    if (type === 'expense' && !expenseTypeId) return res.status(400).json({ success: false, message: 'expenseTypeId required for expense' });
  }
  if (type === 'salary') {
    if (!mazdoorId) return res.status(400).json({ success: false, message: 'mazdoorId required for salary' });
  }

  if (type === 'transfer') {
    const isPartyTransfer = customerId && (supplierId || mazdoorId);
    const isMillToSupplierTransfer = fromAccountId && (supplierId || mazdoorId);
    if (!isPartyTransfer && !isMillToSupplierTransfer && (!fromAccountId || !toAccountId)) {
      return res.status(400).json({ success: false, message: 'fromAccountId and toAccountId required for standard transfer' });
    }
    if (fromAccountId && toAccountId && fromAccountId === toAccountId) {
      return res.status(400).json({ success: false, message: 'Cannot transfer to same account' });
    }
  }

  if (type === 'accrual') {
    if (!mazdoorId) return res.status(400).json({ success: false, message: 'mazdoorId required for accrual' });
  }

  // Validate cheque fields
  if (paymentMethod === 'cheque' && !chequeNumber) {
    return res.status(400).json({ success: false, message: 'Cheque number zaroori hai jab payment method cheque ho.' });
  }

  const transaction = await Transaction.create({
    // Professional Fix: If a string date is provided, force it to UTC 00:00:00.
    // Otherwise, use current absolute time normalized to UTC.
    date: date ? toUTCStartOfDay(date) : toUTCStartOfDay(new Date()),
    type,

    fromAccountId: fromAccountId || null,
    toAccountId: toAccountId || null,
    amount: amt,
    category: (category || '').trim(),
    note: (note || '').trim(),
    supplierId: supplierId || null,
    customerId: customerId || null,
    mazdoorId: mazdoorId || null,
    machineryPurchaseId: machineryPurchaseId || null,
    taxTypeId: taxTypeId || null,
    expenseTypeId: expenseTypeId || null,
    rawMaterialHeadId: rawMaterialHeadId || null,
    image: req.files && req.files.length > 0 ? req.files[0].path : null,
    images: req.files ? req.files.map(f => f.path) : [],
    paymentMethod: paymentMethod || 'cash',
    chequeNumber: (chequeNumber || '').trim(),
    chequeDate: chequeDate ? new Date(chequeDate) : null,
    isSignatureBook: isSignatureBook === 'true' || isSignatureBook === true,
  });

  const populated = await Transaction.findById(transaction._id)
    .populate('fromAccountId', 'name')
    .populate('toAccountId', 'name')
    .populate('supplierId', 'name')
    .populate('customerId', 'name')
    .populate('mazdoorId', 'name')
    .populate('taxTypeId', 'name')
    .populate('expenseTypeId', 'name')
    .populate('rawMaterialHeadId', 'name')
    .lean();
  res.status(201).json({ success: true, data: populated });
};

export const getById = async (req, res) => {
  const { Transaction } = req.models;
  const transaction = await Transaction.findById(req.params.id)
    .populate('fromAccountId', 'name')
    .populate('toAccountId', 'name')
    .populate('supplierId', 'name')
    .populate('customerId', 'name')
    .populate('mazdoorId', 'name')
    .populate('taxTypeId', 'name')
    .populate('expenseTypeId', 'name')
    .populate('rawMaterialHeadId', 'name')
    .lean();
  if (!transaction) {
    return res.status(404).json({ success: false, message: 'Transaction not found' });
  }
  res.json({ success: true, data: transaction });
};

export const update = async (req, res) => {
  const { Transaction } = req.models;
  const { id } = req.params;
  const { type, fromAccountId, toAccountId, amount, category, note, supplierId, customerId, mazdoorId, machineryPurchaseId, taxTypeId, expenseTypeId, rawMaterialHeadId, date, paymentMethod, chequeNumber, chequeDate, isSignatureBook, existingImages } = req.body;

  let existingImagesParsed = [];
  if (typeof existingImages === 'string') {
    try {
      existingImagesParsed = JSON.parse(existingImages);
    } catch (e) {
      existingImagesParsed = [];
    }
  } else if (existingImages) {
    existingImagesParsed = existingImages;
  }

  const transaction = await Transaction.findById(id);
  if (!transaction) {
    return res.status(404).json({ success: false, message: 'Transaction not found' });
  }

  // Prevent editing sales/purchases directly from here if they are system linked
  if (transaction.saleId || transaction.stockEntryId) {
    return res.status(400).json({ success: false, message: 'Cannot edit system-generated transactions (Sales/Purchases) from here. Please use the respective modules.' });
  }

  const amt = Number(amount);
  if (isNaN(amt) || amt <= 0) {
    return res.status(400).json({ success: false, message: 'amount must be a positive number' });
  }

  // Basic validation (same as create)
  if (type === 'deposit' && !toAccountId) return res.status(400).json({ success: false, message: 'toAccountId required for deposit' });
  if ((type === 'withdraw' || type === 'salary' || type === 'tax' || type === 'expense') && !fromAccountId) {
    return res.status(400).json({ success: false, message: `fromAccountId required for ${type}` });
  }
  if (type === 'tax' && !taxTypeId) return res.status(400).json({ success: false, message: 'taxTypeId required for tax payment' });
  if (type === 'expense' && !expenseTypeId) return res.status(400).json({ success: false, message: 'expenseTypeId required for expense' });
  if (type === 'salary' && !mazdoorId) return res.status(400).json({ success: false, message: 'mazdoorId required for salary' });

  // Update fields
  transaction.date = date ? toUTCStartOfDay(date) : transaction.date;
  transaction.type = type || transaction.type;
  transaction.fromAccountId = fromAccountId || null;
  transaction.toAccountId = toAccountId || null;
  transaction.amount = amt;
  transaction.category = (category || '').trim();
  transaction.note = (note || '').trim();
  transaction.supplierId = supplierId || null;
  transaction.customerId = customerId || null;
  transaction.mazdoorId = mazdoorId || null;
  transaction.machineryPurchaseId = machineryPurchaseId || null;
  transaction.taxTypeId = taxTypeId || null;
  transaction.expenseTypeId = expenseTypeId || null;
  transaction.rawMaterialHeadId = rawMaterialHeadId || null;
  transaction.paymentMethod = paymentMethod || 'cash';
  transaction.chequeNumber = (chequeNumber || '').trim();
  transaction.chequeDate = chequeDate ? new Date(chequeDate) : null;
  if (isSignatureBook !== undefined) {
    transaction.isSignatureBook = isSignatureBook === 'true' || isSignatureBook === true;
  }

  if (req.files && req.files.length > 0) {
    const newImages = req.files.map(f => f.path);
    transaction.images = [...existingImagesParsed, ...newImages];
  } else {
    transaction.images = existingImagesParsed;
  }
  transaction.image = transaction.images.length > 0 ? transaction.images[0] : null;

  await transaction.save();

  const populated = await Transaction.findById(transaction._id)
    .populate('fromAccountId', 'name')
    .populate('toAccountId', 'name')
    .populate('supplierId', 'name')
    .populate('customerId', 'name')
    .populate('mazdoorId', 'name')
    .populate('taxTypeId', 'name')
    .populate('expenseTypeId', 'name')
    .populate('rawMaterialHeadId', 'name')
    .lean();

  res.json({ success: true, data: populated });
};

export const remove = async (req, res) => {
  const { Transaction } = req.models;
  const { id } = req.params;

  const transaction = await Transaction.findById(id);
  if (!transaction) {
    return res.status(404).json({ success: false, message: 'Transaction not found' });
  }

  if (transaction.saleId || transaction.stockEntryId) {
    return res.status(400).json({ success: false, message: 'Cannot delete system-generated transactions (Sales/Purchases). Please delete from the respective module.' });
  }

  await Transaction.findByIdAndDelete(id);
  res.json({ success: true, message: 'Transaction deleted' });
};

export { getAccountBalance };

