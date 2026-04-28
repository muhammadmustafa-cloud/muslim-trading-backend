import mongoose from "mongoose";
import { toUTCStartOfDay, toUTCEndOfDay, buildUTCDateFilter } from "../utils/dateUtils.js";

const formatDateOnly = (date) => {
  if (!date) return null;
  return new Date(date).toISOString().slice(0, 10);
};

/**
 * Build date filter for a single day or range.
 */
function dateFilter(dateFrom, dateTo) {
  return buildUTCDateFilter(dateFrom, dateTo);
}

/**
 * GET /api/daily-memo
 * Universal Daily Ledger — strictly follows CASH FLOW using the Transaction model.
 */
export const getDailyMemo = async (req, res) => {
  const { Transaction, Account, Customer, Supplier, Mazdoor, DailyDastiEntry } = req.models;
  const { dateFrom, dateTo, accountId, customerId, supplierId, mazdoorId } = req.query;

  const todayStr = new Date().toISOString().slice(0, 10);
  const fromStr = dateFrom || todayStr;
  const toStr = dateTo || todayStr;

  const fromDate = toUTCStartOfDay(fromStr);
  const toDate = toUTCEndOfDay(toStr);

  const prevMatch = { date: { $lt: fromDate }, type: { $ne: "accrual" } };
  if (accountId) {
    const id = new mongoose.Types.ObjectId(accountId);
    prevMatch.$or = [{ fromAccountId: id }, { toAccountId: id }];
  }
  if (customerId) prevMatch.customerId = new mongoose.Types.ObjectId(customerId);
  if (supplierId) prevMatch.supplierId = new mongoose.Types.ObjectId(supplierId);
  if (mazdoorId) prevMatch.mazdoorId = new mongoose.Types.ObjectId(mazdoorId);

  // 1. Identify "Mill Accounts" (Daily & Mill Khata)
  const allMillAccs = await Account.find({ $or: [{ isDailyKhata: true }, { isMillKhata: true }] }).lean();
  const millAccIds = allMillAccs.map((a) => a._id.toString());
  const millAccObjectIdIds = allMillAccs.map((a) => a._id);

  // Fetch ALL accounts for full summary (includes bank accounts with opening balances)
  const allAccounts = await Account.find().lean();

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
    // Full Mill Summary — sum ALL accounts' opening balances (bank accounts + mill accounts)
    baseOpeningBalance = allAccounts.reduce((sum, a) => sum + (a.openingBalance || 0), 0);
  }

  // 2. Calculate Historical Cash Flow - SIMPLIFIED APPROACH
  // Fetch all transactions before the date range and calculate running balance
  const prevTransactionsList = await Transaction.find(prevMatch)
    .populate("fromAccountId", "isDailyKhata isMillKhata")
    .populate("toAccountId", "isDailyKhata isMillKhata")
    .lean();

  let historicalNetChange = 0;
  
  prevTransactionsList.forEach(t => {
    const fromIsMill = t.fromAccountId?.isDailyKhata || t.fromAccountId?.isMillKhata;
    const toIsMill = t.toAccountId?.isDailyKhata || t.toAccountId?.isMillKhata;
    
    if (accountId) {
      // Specific account view
      const accObjId = accountId.toString();
      const fromId = t.fromAccountId?._id?.toString();
      const toId = t.toAccountId?._id?.toString();
      
      if (t.type === 'transfer') {
        // For transfers: money ARRIVING at account = +ve, LEAVING = -ve
        if (fromId === accObjId) historicalNetChange -= t.amount; // Money left
        if (toId === accObjId) historicalNetChange += t.amount;   // Money arrived
      } else {
        // For deposits/withdrawals
        if (t.type === 'deposit' && toId === accObjId) historicalNetChange += t.amount;
        if ((t.type === 'withdraw' || t.category === 'expense') && fromId === accObjId) historicalNetChange -= t.amount;
      }
    } else if (customerId) {
      // Customer ledger: deposits increase balance, withdraws decrease
      if (t.type === 'deposit') historicalNetChange += t.amount;
      if (t.type === 'withdraw') historicalNetChange -= t.amount;
    } else if (supplierId) {
      // Supplier ledger: deposits increase balance, withdraws decrease
      if (t.type === 'deposit') historicalNetChange += t.amount;
      if (t.type === 'withdraw') historicalNetChange -= t.amount;
    } else if (mazdoorId) {
      // Mazdoor ledger
      if (t.category === 'salary_accrual') historicalNetChange += t.amount;
      if (t.type === 'withdraw' || t.type === 'salary') historicalNetChange -= t.amount;
    } else {
      // Full Mill Summary - Calculate net cash position change
      // Opening balance = Base + Net flow from previous transactions
      // Net flow = Money entering mill accounts - Money leaving mill accounts
      
      // Money entering mill accounts (deposits, transfers to mill)
      if (toIsMill) {
        historicalNetChange += t.amount;
      }
      
      // Money leaving mill accounts (withdrawals, expenses, transfers from mill)
      if (fromIsMill) {
        historicalNetChange -= t.amount;
      }
      
      // Note: Internal transfers between mill accounts cancel out (+amount and -amount)
      // So they don't affect the net calculation
    }
  });

  const openingBalance = baseOpeningBalance + historicalNetChange;

  const currMatch = {
    date: { $gte: fromDate, $lte: toDate },
    type: { $ne: "accrual" },
  };
  if (accountId) {
    const id = new mongoose.Types.ObjectId(accountId);
    currMatch.$or = [{ fromAccountId: id }, { toAccountId: id }];
  }
  if (customerId) currMatch.customerId = new mongoose.Types.ObjectId(customerId);
  if (supplierId) currMatch.supplierId = new mongoose.Types.ObjectId(supplierId);
  if (mazdoorId) currMatch.mazdoorId = new mongoose.Types.ObjectId(mazdoorId);

  const transactions = await Transaction.find(currMatch)
    .populate("fromAccountId", "name type isDailyKhata isMillKhata showMirrorInDailyMemo")
    .populate("toAccountId", "name isDailyKhata isMillKhata showMirrorInDailyMemo")
    .populate("supplierId", "name")
    .populate("customerId", "name")
    .populate("mazdoorId", "name")
    .populate({
      path: "saleId",
      select: "truckNumber items itemName",
      populate: { path: "items.itemId", select: "name" },
    })
    .populate({
      path: "stockEntryId",
      select: "truckNumber items",
      populate: { path: "items.itemId", select: "name" },
    })
    .populate({
      path: "machineryPurchaseId",
      populate: { path: "machineryItemId", select: "name" },
    })
    .populate("taxTypeId", "name")
    .populate("expenseTypeId", "name")
    .populate("rawMaterialHeadId", "name")
    .sort({ date: 1, createdAt: 1 })
    .lean();

  const isOperationalAccount = (acc) => !!(acc?.isDailyKhata || acc?.isMillKhata);
  const isInternalTransfer = (t) => t.type === "transfer" && isOperationalAccount(t.fromAccountId) && isOperationalAccount(t.toAccountId);
  const rows = [];

  transactions.forEach((t) => {
    const type = t.type;
    const category = t.category || "";
    let partyName = t.customerId?.name || t.supplierId?.name || "";
    const hasParty = !!partyName;

    let desc = "";
    if (t.saleId) {
      const bill = t.saleId._id?.toString().slice(-6).toUpperCase() || "—";
      const itemNames = t.saleId.items?.length > 0 ? t.saleId.items.map((it) => it.itemId?.name || "Item").join(", ") : t.saleId.itemName || "Item";
      desc = `Sale — ${itemNames} (Bill: ${bill})`;
    } else if (t.stockEntryId) {
      const bill = t.stockEntryId._id?.toString().slice(-6).toUpperCase() || "—";
      const itemNames = t.stockEntryId.items?.length > 0 ? t.stockEntryId.items.map((it) => it.itemId?.name || "Item").join(", ") : "Item";
      desc = `Purchase — ${itemNames} (Bill: ${bill})`;
    } else if (t.machineryPurchaseId) {
      desc = `Machinery — ${t.machineryPurchaseId.machineryItemId?.name || "Part/Asset"}`;
    } else if (t.taxTypeId) desc = "Tax Payment";
    else if (t.expenseTypeId) desc = "General Expense";
    else if (t.rawMaterialHeadId) desc = `Raw Material — ${t.rawMaterialHeadId.name || "Item"}`;
    else if (category === "mill_expense") desc = "Mill Expense";
    else if (category === "mazdoor_expense") desc = "Mazdoor Expense";
    else desc = t.note || category.replace("_", " ");

    let displayName = partyName;
    if (!displayName) {
      if (category === "mill_expense") displayName = (t.note || "").replace(/^Mill:\s*/i, "") || "Mill Expense";
      else if (category === "mazdoor_expense") displayName = t.mazdoorId?.name ? `Mazdoor: ${t.mazdoorId.name}` : t.note || "Mazdoor Expense";
      else if (t.mazdoorId) displayName = t.mazdoorId.name || "Mazdoor";
      else if (t.taxTypeId) displayName = t.taxTypeId.name || "Tax Payment";
      else if (t.expenseTypeId) displayName = t.expenseTypeId.name || "General Expense";
      else if (t.rawMaterialHeadId) displayName = t.rawMaterialHeadId.name || "Raw Material";
    }

    if (t.paymentMethod === "cheque") desc += ` | Cheque #${t.chequeNumber || "—"}`;
    else if (t.paymentMethod === "online") desc += " | Online";

    // Track "Master Totals" only for external cash flow
    const isExternal = !isInternalTransfer(t) && type !== "transfer";

    if (type === "deposit") {
      const isBankDest = t.toAccountId?.type === "Bank";
      const accountAmountType = isBankDest ? "out" : "in"; // Bank Deposit = Money leaving box (Kharch), Cash Deposit = Aamad
      const partyAmountType = isBankDest ? "in" : "out"; // If giving to bank (Kharch), the "Source" is Aamad? No, usually symmetric.

      // 1. Primary Move: Money enters the Account (Credit/Aamad from Shop perspective)
      rows.push({
        type: category || "deposit",
        date: formatDateOnly(t.date),
        name: t.toAccountId?.name || "Account",
        description: desc,
        accountName: displayName || "Manual",
        amount: t.amount,
        amountType: accountAmountType,
        isExternal,
        referenceId: t._id,
      });

      // 2. Contra Move: Money received from Participant (Debit/Kharch) - ONLY if participant exists AND mirroring enabled
      if (hasParty && t.toAccountId?.showMirrorInDailyMemo !== false) {
        rows.push({
          type: category || "deposit",
          date: formatDateOnly(t.date),
          name: displayName,
          description: desc,
          accountName: t.toAccountId?.name || "Manual",
          amount: t.amount,
          amountType: isBankDest ? "in" : "out",
          isExternal,
          referenceId: t._id,
        });
      }
    } else if (["withdraw", "salary", "tax", "expense"].includes(type)) {
      const isBankSource = t.fromAccountId?.type === "Bank";

      // 1. Primary Move: Money leaves the Account (Debit/Kharch from Shop perspective)
      rows.push({
        type: category || type,
        date: formatDateOnly(t.date),
        name: t.fromAccountId?.name || "Account",
        description: desc,
        accountName: displayName || "Manual",
        amount: t.amount,
        amountType: "out", // Account pays = Kharch (Debit side)
        isExternal,
        referenceId: t._id,
      });

      // 2. Contra Move (Aamne-Samne): opposite side of the transaction
      // Added check for showMirrorInDailyMemo to allow single-sided entries
      const shouldContra = (hasParty || (isBankSource && displayName)) && t.fromAccountId?.showMirrorInDailyMemo !== false;
      if (shouldContra) {
        rows.push({
          type: category || type,
          date: formatDateOnly(t.date),
          name: displayName,
          description: desc,
          accountName: t.fromAccountId?.name || "Manual",
          amount: t.amount,
          amountType: "in", // Recipient receives = Aamad (Credit side)
          isExternal,
          referenceId: t._id,
        });
      }
    } else if (type === "transfer") {
      const isPartyTransfer = t.customerId && (t.supplierId || t.mazdoorId);
      const isAccountToPartyTransfer = t.fromAccountId && (t.supplierId || t.mazdoorId);

      if (isPartyTransfer || isAccountToPartyTransfer) {
        const sourceName = t.customerId?.name || t.fromAccountId?.name || "Source";
        const recipientName = t.supplierId?.name || t.mazdoorId?.name || "Recipient";

        // 1. Source Side (Credit / Aamad)
        rows.push({
          type: "transfer_in",
          date: formatDateOnly(t.date),
          name: `Direct Transfer to ${recipientName}`,
          description: t.note || "Party-to-Party Transfer",
          accountName: sourceName,
          amount: t.amount,
          amountType: "in",
          isExternal: false, // Internal to the ledger ecosystem
          referenceId: t._id
        });

        // 2. Destination Side (Debit / Kharch)
        rows.push({
          type: "transfer_out",
          date: formatDateOnly(t.date),
          name: `Direct Transfer from ${sourceName}`,
          description: t.note || "Party-to-Party Transfer",
          accountName: recipientName,
          amount: t.amount,
          amountType: "out",
          isExternal: false,
          referenceId: t._id
        });
      } else {
        // Internal standard account-to-account transfers
        // BUSINESS RULE: fromAccount = CREDIT (in), toAccount = DEBIT (out)
        if (t.fromAccountId?.showMirrorInDailyMemo !== false) {
          rows.push({ 
            type: "transfer_out", 
            date: formatDateOnly(t.date), 
            name: t.fromAccountId?.name || "Account", 
            description: `Transfer to ${t.toAccountId?.name || "—"}`, 
            accountName: t.fromAccountId?.name || "Manual", 
            amount: t.amount, 
            amountType: "in", // fromAccount = CREDIT (in) per business rule
            isExternal, 
            referenceId: t._id 
          });
        }
        if (t.toAccountId?.showMirrorInDailyMemo !== false) {
          rows.push({ 
            type: "transfer_in", 
            date: formatDateOnly(t.date), 
            name: t.toAccountId?.name || "Account", 
            description: `Transfer from ${t.fromAccountId?.name || "—"}`, 
            accountName: t.toAccountId?.name || "Manual", 
            amount: t.amount, 
            amountType: "out", // toAccount = DEBIT (out) per business rule
            isExternal, 
            referenceId: t._id 
          });
        }
      }
    }
  });

  // Calculate summary based on the actual rows displayed (Gross Turnover Logic)
  const todayIn = rows.reduce((sum, r) => sum + (r.amountType === "in" ? r.amount : 0), 0);
  const todayOut = rows.reduce((sum, r) => sum + (r.amountType === "out" ? r.amount : 0), 0);
  // 3. Fetch Dasti Entries for the same period
  const dastiEntries = await DailyDastiEntry.find({
    date: { $gte: fromDate, $lte: toDate },
  })
    .sort({ date: 1, createdAt: 1 })
    .lean();
  // Prepare debug info for troubleshooting
  const debug = {
    dateRange: { from: fromStr, to: toStr },
    fromDateUTC: fromDate,
    toDateUTC: toDate,
    baseOpeningBalance,
    historicalNetChange,
    calculatedOpeningBalance: openingBalance,
    prevTransactionsCount: prevTransactionsList.length,
    allAccountsSummary: allAccounts
      .filter(a => (a.openingBalance || 0) !== 0)
      .map(a => ({ 
        name: a.name, 
        openingBalance: a.openingBalance || 0,
        isDailyKhata: a.isDailyKhata,
        isMillKhata: a.isMillKhata
      }))
      .sort((a, b) => b.openingBalance - a.openingBalance),
    samplePrevTransactions: prevTransactionsList.slice(-5).map(t => ({
      date: t.date,
      type: t.type,
      amount: t.amount,
      fromAccount: t.fromAccountId?.name,
      fromIsMill: t.fromAccountId?.isDailyKhata || t.fromAccountId?.isMillKhata,
      toAccount: t.toAccountId?.name,
      toIsMill: t.toAccountId?.isDailyKhata || t.toAccountId?.isMillKhata,
      category: t.category
    }))
  };

  res.set("Cache-Control", "no-store");
  res.json({
    success: true,
    data: rows,
    dastiEntries: dastiEntries.map((d) => ({
      ...d,
      date: formatDateOnly(d.date),
    })),
    summary: {
      openingBalance,
      totalIn: todayIn,
      totalOut: todayOut,
      net: todayIn - todayOut,
      closingBalance: openingBalance + todayIn - todayOut,
    },
    debug, // ← Now visible in browser DevTools
  });
};
