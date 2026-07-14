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

const buildLedgerRows = (transactions) => {
  const rows = [];

  const isOperationalAccount = (acc) => !!(acc?.isDailyKhata || acc?.isMillKhata);

  transactions.forEach((t) => {
    const type = t.type;
    const category = t.category || "";
    let partyName = t.customerId?.name || t.supplierId?.name || t.mazdoorId?.name || "";
    const hasParty = !!partyName;

    let desc = t.note || category.replace("_", " ");

    if (t.saleId) {
      const bill = t.saleId._id?.toString().slice(-6).toUpperCase() || "—";
      const itemNames = t.saleId.items?.length > 0 
        ? t.saleId.items.map((it) => it.itemId?.name || "Item").join(", ") 
        : t.saleId.itemName || "Item";
      desc = `Sale — ${itemNames} (Bill: ${bill})`;
    } else if (t.stockEntryId) {
      const bill = t.stockEntryId._id?.toString().slice(-6).toUpperCase() || "—";
      const itemNames = t.stockEntryId.items?.length > 0 
        ? t.stockEntryId.items.map((it) => it.itemId?.name || "Item").join(", ") 
        : "Item";
      desc = `Purchase — ${itemNames} (Bill: ${bill})`;
    } else if (t.machineryPurchaseId) {
      desc = `Machinery — ${t.machineryPurchaseId.machineryItemId?.name || "Part/Asset"}`;
    } else if (t.taxTypeId) desc = "Tax Payment";
    else if (t.expenseTypeId) desc = "General Expense";
    else if (t.rawMaterialHeadId) desc = `Raw Material — ${t.rawMaterialHeadId.name || "Item"}`;
    else if (category === "mill_expense") desc = "Mill Expense";
    else if (category === "mazdoor_expense") desc = "Mazdoor Expense";

    let displayName = partyName;
    if (!displayName) {
      if (category === "mill_expense") displayName = (t.note || "").replace(/^Mill:\s*/i, "") || "Mill Expense";
      else if (category === "mazdoor_expense") displayName = t.mazdoorId?.name ? `Mazdoor: ${t.mazdoorId.name}` : t.note || "Mazdoor Expense";
      else if (t.mazdoorId) displayName = t.mazdoorId.name || "Mazdoor";
      else if (t.taxTypeId) displayName = t.taxTypeId.name || "Tax Payment";
      else if (t.expenseTypeId) displayName = t.expenseTypeId.name || "General Expense";
      else if (t.rawMaterialHeadId) displayName = t.rawMaterialHeadId.name || "Raw Material";
      else displayName = "Manual";
    }

    if (t.paymentMethod === "cheque") desc += ` | Cheque #${t.chequeNumber || "—"}`;
    else if (t.paymentMethod === "online") desc += " | Online";

    const isInternalTransfer = t.type === "transfer" && 
      isOperationalAccount(t.fromAccountId) && 
      isOperationalAccount(t.toAccountId);

    // ==================== ROW GENERATION ====================
    if (type === "deposit") {
      const isBankDest = t.toAccountId?.type === "Bank";

      // Primary: Money entering account
      // For non-bank deposits: Customer is the source, Account is the destination
      // UI renders "{accountName} ➔ {name}", so swap fields for non-bank to show "Customer ➔ Account"
      rows.push({
        type: category || "deposit",
        date: formatDateOnly(t.date),
        name: isBankDest ? (displayName || "Manual") : (t.toAccountId?.name || "Account"),
        description: desc,
        accountName: isBankDest ? (t.toAccountId?.name || "Account") : (displayName || "Manual"),
        amount: t.amount,
        amountType: isBankDest ? "out" : "in",
        isExternal: !isInternalTransfer,
        referenceId: t._id,
      });

      // Contra (Mirror)
      if (hasParty && t.toAccountId?.showMirrorInDailyMemo !== false) {
        rows.push({
          type: category || "deposit",
          date: formatDateOnly(t.date),
          name: t.toAccountId?.name,
          description: desc,
          accountName: displayName || "Manual",
          amount: t.amount,
          amountType: isBankDest ? "in" : "out",
          isExternal: !isInternalTransfer,
          referenceId: t._id,
        });
      }
    } 
    else if (["withdraw", "salary", "tax", "expense"].includes(type)) {
      const isBankSource = t.fromAccountId?.type === "Bank";
      const isMirrorFalse = t.fromAccountId?.showMirrorInDailyMemo === false;

      // Primary: Money leaving account
      rows.push({
        type: category || type,
        date: formatDateOnly(t.date),
        // If mirror is explicitly false, flip names to render "Account ➔ Party" on Kharch side
        name: isMirrorFalse ? (displayName || "Manual") : (t.fromAccountId?.name || "Manual"),
        description: desc,
        accountName: isMirrorFalse ? (t.fromAccountId?.name || "Account") : (displayName || "Account"),
        amount: t.amount,
        amountType: "out",
        isExternal: !isInternalTransfer,
        referenceId: t._id,
      });

      // Contra
      const shouldContra = (hasParty || (isBankSource && displayName)) && !isMirrorFalse;

      if (shouldContra) {
        rows.push({
          type: category || type,
          date: formatDateOnly(t.date),
          name: displayName,
          description: desc,
          accountName: t.fromAccountId?.name || "Manual",
          amount: t.amount,
          amountType: "in",
          isExternal: !isInternalTransfer,
          referenceId: t._id,
        });
      }
    } 
    else if (type === "transfer") {
      const isPartyTransfer = t.customerId && (t.supplierId || t.mazdoorId);
      const isAccountToPartyTransfer = t.fromAccountId && (t.supplierId || t.mazdoorId);

    if (isPartyTransfer || isAccountToPartyTransfer) {

  const fromAcc = t.fromAccountId?.name || "Cash";
  const toAcc = t.toAccountId?.name || "Cash";

  const customerName = t.customerId?.name;
  const supplierName = t.supplierId?.name;
  const mazdoorName = t.mazdoorId?.name;

  // 🎯 Detect Giver & Receiver PROPERLY
  let giver = "";
  let receiver = "";

  // Case 1: Customer → Supplier
  if (customerName && supplierName) {
    giver = customerName;
    receiver = supplierName;
  }

  // Case 2: Account → Supplier/Mazdoor
  else if (t.fromAccountId && (supplierName || mazdoorName)) {
    giver = fromAcc;
    receiver = supplierName || mazdoorName;
  }

  // Case 3: Supplier → Account (rare but possible)
  else if (t.toAccountId && (supplierName || mazdoorName)) {
    giver = supplierName || mazdoorName;
    receiver = toAcc;
  }

  // Fallback
  else {
    giver = fromAcc;
    receiver = toAcc;
  }

  // ✅ CREDIT (Receiver)
  rows.push({
    type: "transfer_in",
    date: formatDateOnly(t.date),
    name: receiver,              // ✔ Always receiver
    description: `${giver} → ${receiver}`,
    accountName: giver,          // ✔ From
    amount: t.amount,
    amountType: "in",
    isExternal: false,
    referenceId: t._id
  });

  // ✅ DEBIT (Giver)
  rows.push({
    type: "transfer_out",
    date: formatDateOnly(t.date),
    name: giver,                 // ✔ Always giver
    description: `${giver} → ${receiver}`,
    accountName: receiver,       // ✔ To
    amount: t.amount,
    amountType: "out",
    isExternal: false,
    referenceId: t._id
  });
} else {
        // Normal Account to Account Transfer
        if (t.fromAccountId?.showMirrorInDailyMemo !== false) {
          rows.push({
            type: "transfer_out",
            date: formatDateOnly(t.date),
            name: t.fromAccountId?.name || "Account",
            description: `Transfer to ${t.toAccountId?.name || "—"}`,
            accountName: t.fromAccountId?.name || "Manual",
            amount: t.amount,
            amountType: "in",           // From = Credit (in)
            isExternal: false,
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
            amountType: "out",          // To = Debit (out)
            isExternal: false,
            referenceId: t._id
          });
        }
      }
    }
  });

  return rows;
};

/**
 * GET /api/daily-memo
 * Universal Daily Ledger — strictly follows CASH FLOW using the Transaction model.
 */
export const buildDailyMemo = async (models, filters = {}) => {
  const { Transaction, Account, Customer, Supplier, Mazdoor, DailyDastiEntry } = models;
  const { dateFrom, dateTo, accountId, customerId, supplierId, mazdoorId } = filters;

  const todayStr = new Date().toISOString().slice(0, 10);
  const fromStr = dateFrom || todayStr;
  const toStr = dateTo || todayStr;

  const fromDate = toUTCStartOfDay(fromStr);
  const toDate = toUTCEndOfDay(toStr);

  // 1. Base Opening Balance (from Account/Customer/Supplier/Mazdoor)
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
    const allMillAccs = await Account.find({ 
      $or: [
        { isDailyKhata: true }, 
        { isMillKhata: true },
        { showMirrorInDailyMemo: false }
      ] 
    }).lean();
    baseOpeningBalance = allMillAccs.reduce((sum, a) => sum + (a.openingBalance || 0), 0);
  }

  // ====================== CALCULATE OPENING BALANCE (PREVIOUS DAYS) ======================
  const prevToDate = new Date(fromDate.getTime() - 1); // One ms before fromDate

  const prevMatch = {
    date: { $lte: prevToDate },
    type: { $ne: "accrual" },
  };

  if (accountId) {
    const id = new mongoose.Types.ObjectId(accountId);
    prevMatch.$or = [{ fromAccountId: id }, { toAccountId: id }];
  }
  if (customerId) prevMatch.customerId = new mongoose.Types.ObjectId(customerId);
  if (supplierId) prevMatch.supplierId = new mongoose.Types.ObjectId(supplierId);
  if (mazdoorId) prevMatch.mazdoorId = new mongoose.Types.ObjectId(mazdoorId);

  const prevTransactions = await Transaction.find(prevMatch)
    .populate("fromAccountId", "name type isDailyKhata isMillKhata showMirrorInDailyMemo")
    .populate("toAccountId", "name type isDailyKhata isMillKhata showMirrorInDailyMemo")
    .populate("supplierId", "name")
    .populate("customerId", "name")
    .populate("mazdoorId", "name")
    .lean();

  const prevRows = buildLedgerRows(prevTransactions);

  const historicalIn = prevRows.reduce((sum, r) => sum + (r.amountType === "in" ? Number(r.amount) : 0), 0);
  const historicalOut = prevRows.reduce((sum, r) => sum + (r.amountType === "out" ? Number(r.amount) : 0), 0);

  const openingBalance = baseOpeningBalance + historicalIn - historicalOut;

  // ====================== CURRENT PERIOD TRANSACTIONS ======================
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
    .populate("toAccountId", "name type isDailyKhata isMillKhata showMirrorInDailyMemo")
    .populate("supplierId", "name")
    .populate("customerId", "name")
    .populate("mazdoorId", "name")
    .populate({ path: "saleId", select: "truckNumber items itemName", populate: { path: "items.itemId", select: "name" } })
    .populate({ path: "stockEntryId", select: "truckNumber items", populate: { path: "items.itemId", select: "name" } })
    .populate({ path: "machineryPurchaseId", populate: { path: "machineryItemId", select: "name" } })
    .populate("taxTypeId", "name")
    .populate("expenseTypeId", "name")
    .populate("rawMaterialHeadId", "name")
    .sort({ date: 1, createdAt: 1 })
    .lean();

  const rows = buildLedgerRows(transactions);

  // ====================== DASTI ENTRIES ======================
  const dastiEntries = await DailyDastiEntry.find({
    date: { $gte: fromDate, $lte: toDate },
  }).sort({ date: 1, createdAt: 1 }).lean();

  // ====================== SUMMARY ======================
  const totalIn = rows.reduce((sum, r) => sum + (r.amountType === "in" ? Number(r.amount) : 0), 0);
  const totalOut = rows.reduce((sum, r) => sum + (r.amountType === "out" ? Number(r.amount) : 0), 0);

  const closingBalance = openingBalance + totalIn - totalOut;

  return {
    data: rows,
    dastiEntries: dastiEntries.map((d) => ({
      ...d,
      date: formatDateOnly(d.date),
    })),
    summary: {
      openingBalance: Math.round(openingBalance),
      totalIn: Math.round(totalIn),
      totalOut: Math.round(totalOut),
      net: Math.round(totalIn - totalOut),
      closingBalance: Math.round(closingBalance),
    }
  };
};

export const getDailyMemo = async (req, res) => {
  try {
    const result = await buildDailyMemo(req.models, req.query);
    res.set("Cache-Control", "no-store");
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
