import mongoose from 'mongoose';
import { toUTCStartOfDay, buildUTCDateFilter } from '../utils/dateUtils.js';

/**
 * Party Ledger — Unified Sale + Purchase + Payment detail for a single person.
 *
 * GET /party-ledger/:id?role=customer|supplier&dateFrom=&dateTo=&itemId=
 *
 * Returns one row per INVOICE (not per item), with aggregated weight/MUN/bags,
 * plus payment rows, all with a running balance.
 */
export const getPartyLedger = async (req, res) => {
  const { Customer, Supplier, Sale, StockEntry, Transaction } = req.models;
  const { role, dateFrom, dateTo, itemId } = req.query;
  const personId = req.params.id;

  // ── 1. Resolve the person and their linked counterpart ──
  let person = null;
  let customerId = null;
  let supplierId = null;
  let personName = '';
  let personPhone = '';
  let personAddress = '';
  let openingBalance = 0;
  let isLinked = false;

  if (role === 'supplier') {
    person = await Supplier.findById(personId).populate('linkedCustomerId', 'name').lean();
    if (!person) return res.status(404).json({ success: false, message: 'Supplier not found' });
    supplierId = personId;
    customerId = person.linkedCustomerId?._id?.toString() || null;
    isLinked = !!customerId;
    personName = person.name;
    personPhone = person.phone || '';
    personAddress = person.address || '';
    openingBalance = person.openingBalance || 0;
  } else {
    // Default to customer
    person = await Customer.findById(personId).populate('linkedSupplierId', 'name').lean();
    if (!person) return res.status(404).json({ success: false, message: 'Customer not found' });
    customerId = personId;
    supplierId = person.linkedSupplierId?._id?.toString() || null;
    isLinked = !!supplierId;
    personName = person.name;
    personPhone = person.phone || '';
    personAddress = person.address || '';
    openingBalance = person.openingBalance || 0;
  }

  // ── 2. Build date filter ──
  const dateFilterObj = buildUTCDateFilter(dateFrom, dateTo);
  const dateFilter = dateFilterObj.date || {};
  const hasDateFilter = Object.keys(dateFilter).length > 0;

  // ── 3. Build query matches ──
  const saleMatch = customerId ? { customerId: new mongoose.Types.ObjectId(customerId) } : null;
  if (saleMatch && hasDateFilter) saleMatch.date = dateFilter;

  const stockMatch = supplierId ? { supplierId: new mongoose.Types.ObjectId(supplierId) } : null;
  if (stockMatch && hasDateFilter) stockMatch.date = dateFilter;

  // Item filter (applied inside items array)
  const itemObjId = itemId ? new mongoose.Types.ObjectId(itemId) : null;
  if (itemObjId && saleMatch) saleMatch['items.itemId'] = itemObjId;
  if (itemObjId && stockMatch) stockMatch['items.itemId'] = itemObjId;

  // Transaction match: look for both customer and supplier IDs
  const transOrConditions = [];
  if (customerId) transOrConditions.push({ customerId: new mongoose.Types.ObjectId(customerId) });
  if (supplierId) transOrConditions.push({ supplierId: new mongoose.Types.ObjectId(supplierId) });

  const transMatch = transOrConditions.length > 0 ? { $or: transOrConditions } : { _id: null }; // impossible match if neither
  if (hasDateFilter) transMatch.date = dateFilter;

  // ── 4. Fetch all data in parallel ──
  const [sales, stockEntries, transactions] = await Promise.all([
    saleMatch
      ? Sale.find(saleMatch)
          .populate({ path: 'items.itemId', select: 'name quality' })
          .populate('accountId', 'name')
          .lean()
      : [],
    stockMatch
      ? StockEntry.find(stockMatch)
          .populate({ path: 'items.itemId', select: 'name quality' })
          .populate('accountId', 'name')
          .lean()
      : [],
    Transaction.find(transMatch)
      .populate('fromAccountId', 'name')
      .populate('toAccountId', 'name')
      .populate('customerId', 'name')
      .populate('supplierId', 'name')
      .lean(),
  ]);

  // Also get transactions linked via saleId/stockEntryId that might not match on customerId/supplierId
  const saleIds = sales.map(s => s._id);
  const stockIds = stockEntries.map(e => e._id);
  const existingTransIds = new Set(transactions.map(t => t._id.toString()));

  let extraTrans = [];
  const extraOrConditions = [];
  if (saleIds.length > 0) extraOrConditions.push({ saleId: { $in: saleIds } });
  if (stockIds.length > 0) extraOrConditions.push({ stockEntryId: { $in: stockIds } });

  if (extraOrConditions.length > 0) {
    const found = await Transaction.find({ $or: extraOrConditions })
      .populate('fromAccountId', 'name')
      .populate('toAccountId', 'name')
      .lean();
    extraTrans = found.filter(t => !existingTransIds.has(t._id.toString()));
  }

  const allTransactions = [...transactions, ...extraTrans];

  // Deduplicate
  const seenTrans = new Set();
  const uniqueTransactions = allTransactions.filter(t => {
    if (seenTrans.has(t._id.toString())) return false;
    seenTrans.add(t._id.toString());
    return true;
  });

  // ── 5. Build ledger rows ──
  const ledger = [];

  // Opening balance row
  const startBoundary = dateFrom ? toUTCStartOfDay(dateFrom) : null;
  if (!dateFrom || (startBoundary && startBoundary <= new Date(person.createdAt))) {
    if (openingBalance !== 0) {
      ledger.push({
        date: person.createdAt,
        type: 'opening',
        description: 'Opening Balance',
        itemNames: '',
        bags: 0,
        grossWeight: 0,
        netWeight: 0,
        mun: 0,
        avgRate: 0,
        debit: openingBalance > 0 ? openingBalance : 0,
        credit: openingBalance < 0 ? Math.abs(openingBalance) : 0,
        truckNumber: '',
        refId: null,
      });
    }
  }

  // ── Sale rows (Dr for customer) ──
  sales.forEach(s => {
    const itemNames = (s.items && s.items.length > 0)
      ? s.items.map(it => it.itemId?.name || 'Item').join(', ')
      : 'Item';

    const totalBags = s.items?.reduce((sum, it) => sum + (it.kattay || 0), 0) || 0;
    const totalGross = s.totalGrossWeight || 0;
    const totalNet = s.netWeight || (totalGross - (s.totalSHCut || 0));
    const totalMun = totalNet > 0 ? totalNet / 40 : 0;

    // Calculate weighted average rate
    const totalAmount = s.totalAmount || s.items?.reduce((sum, it) => sum + (it.totalAmount || 0), 0) || 0;
    const avgRate = totalMun > 0 ? Math.round(totalAmount / totalMun) : 0;

    ledger.push({
      date: s.date,
      type: 'sale',
      description: `Sale: ${itemNames}`,
      itemNames,
      bags: totalBags,
      grossWeight: totalGross,
      netWeight: totalNet,
      mun: Number(totalMun.toFixed(4)),
      avgRate,
      debit: totalAmount,
      credit: 0,
      truckNumber: s.truckNumber || '',
      refId: s._id,
    });
  });

  // ── Purchase rows (Cr for customer-perspective, Dr if viewing as supplier) ──
  stockEntries.forEach(e => {
    const itemNames = (e.items && e.items.length > 0)
      ? e.items.map(it => it.itemId?.name || 'Item').join(', ')
      : 'Item';

    const totalBags = e.items?.reduce((sum, it) => sum + (it.kattay || 0), 0) || 0;
    const totalGross = e.totalGrossWeight || 0;
    const totalNet = e.receivedWeight || (totalGross - (e.totalSHCut || 0));
    const totalMun = totalNet > 0 ? totalNet / 40 : 0;

    // Use items sum for amount (avoids double-counting bug in e.amount)
    const totalAmount = (e.items && e.items.length > 0)
      ? e.items.reduce((sum, it) => sum + (Number(it.amount) || 0), 0)
      : Number(e.amount) || 0;

    const avgRate = totalMun > 0 ? Math.round(totalAmount / totalMun) : 0;

    ledger.push({
      date: e.date,
      type: 'purchase',
      description: `Purchase: ${itemNames}`,
      itemNames,
      bags: totalBags,
      grossWeight: totalGross,
      netWeight: totalNet,
      mun: Number(totalMun.toFixed(4)),
      avgRate,
      debit: 0,
      credit: totalAmount,
      truckNumber: e.truckNumber || '',
      refId: e._id,
    });
  });

  // ── Payment rows ──
  uniqueTransactions.forEach(p => {
    const amount = Number(p.amount) || 0;
    if (!amount) return;

    let isDebit = false;
    let isCredit = false;

    // Determine direction based on transaction type
    if (p.type === 'deposit') {
      // Money received into our account → credit (reduces receivable)
      isCredit = true;
    } else if (p.type === 'withdraw' || p.type === 'withdrawal') {
      // Money paid out → debit (reduces payable)
      isDebit = true;
    } else if (p.type === 'transfer') {
      // Check if the person is sender or receiver
      const pCustId = p.customerId?._id?.toString() || p.customerId?.toString();
      const pSupId = p.supplierId?._id?.toString() || p.supplierId?.toString();

      if (supplierId && pSupId === supplierId) {
        // Supplier is receiver = debit (they got paid)
        isDebit = true;
      } else if (customerId && pCustId === customerId) {
        // Customer is sender = credit (they paid us)
        isCredit = true;
      } else {
        // Fallback
        isCredit = true;
      }
    }

    // Fallback for unclassified
    if (!isDebit && !isCredit) {
      isCredit = true;
    }

    // Build description
    const fromAccount = p.fromAccountId?.name;
    const toAccount = p.toAccountId?.name;
    let paymentDesc = '';

    if (p.type === 'deposit') {
      paymentDesc = `Payment Received via ${toAccount || 'Cash'}`;
    } else if (p.type === 'withdraw' || p.type === 'withdrawal') {
      paymentDesc = `Payment Made via ${fromAccount || 'Cash'}`;
    } else if (p.type === 'transfer') {
      paymentDesc = `Transfer (${fromAccount || 'Cash'} → ${toAccount || 'Cash'})`;
    } else {
      paymentDesc = `Transaction (${p.type})`;
    }

    if (p.note) paymentDesc += ` — ${p.note}`;

    ledger.push({
      date: p.date,
      type: 'payment',
      description: paymentDesc,
      itemNames: '',
      bags: 0,
      grossWeight: 0,
      netWeight: 0,
      mun: 0,
      avgRate: 0,
      debit: isDebit ? amount : 0,
      credit: isCredit ? amount : 0,
      truckNumber: '',
      refId: p._id,
    });
  });

  // ── 6. Sort by date ──
  ledger.sort((a, b) => new Date(a.date) - new Date(b.date));

  // ── 7. Calculate running balance ──
  let currentBalance = 0;
  ledger.forEach(item => {
    currentBalance += (item.debit - item.credit);
    item.balance = currentBalance;
  });

  // ── 8. Summary aggregation ──
  const saleRows = ledger.filter(r => r.type === 'sale');
  const purchaseRows = ledger.filter(r => r.type === 'purchase');
  const paymentRows = ledger.filter(r => r.type === 'payment');

  const summary = {
    openingBalance,
    totalSaleAmount: saleRows.reduce((sum, r) => sum + r.debit, 0),
    totalPurchaseAmount: purchaseRows.reduce((sum, r) => sum + r.credit, 0),
    totalSaleBags: saleRows.reduce((sum, r) => sum + r.bags, 0),
    totalPurchaseBags: purchaseRows.reduce((sum, r) => sum + r.bags, 0),
    totalSaleMun: saleRows.reduce((sum, r) => sum + r.mun, 0),
    totalPurchaseMun: purchaseRows.reduce((sum, r) => sum + r.mun, 0),
    totalPaymentsReceived: paymentRows.reduce((sum, r) => sum + r.credit, 0),
    totalPaymentsMade: paymentRows.reduce((sum, r) => sum + r.debit, 0),
    netBalance: currentBalance,
  };

  // ── 9. Respond ──
  res.json({
    success: true,
    data: {
      name: personName,
      phone: personPhone,
      address: personAddress,
      isLinked,
      linkedRole: isLinked ? (role === 'supplier' ? 'customer' : 'supplier') : null,
      ledger,
      summary,
    },
  });
};
