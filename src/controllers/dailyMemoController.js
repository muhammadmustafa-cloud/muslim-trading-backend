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
  console.log("API HIT: getDailyMemo");
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
              {
                $or: [
                  // Case A: Specific Account selected + Source=Credit logic
                  { $and: [!!accountId, { $ne: ["$type", "transfer"] }, { $eq: ["$toAccountId", new mongoose.Types.ObjectId(accountId)] }] },
                  { $and: [!!accountId, { $eq: ["$type", "transfer"] }, { $eq: ["$fromAccountId", new mongoose.Types.ObjectId(accountId)] }] },
                  // Case B: Full Mill Summary + money entered ANY Mill Account
                  // (Internal transfers cancel out; external toAccount handled separately)
                  { $and: [!accountId, !customerId && !supplierId && !mazdoorId, { $in: ["$toAccountId", millAccObjectIdIds] }] },
                  // Case C: Party ledgers
                  { $and: [!!customerId, { $eq: ["$type", "deposit"] }] },
                  { $and: [!!supplierId, { $eq: ["$type", "deposit"] }] },
                  { $and: [!!mazdoorId, { $eq: ["$category", "salary_accrual"] }] },
                  /**
                   * Case D: ALL Transfers INTO Mill Accounts → Count in Credit (totalIn)
                   * This handles: External→Mill, Mill→Mill transfers
                   * Mill→External is handled in totalOut, creating net-zero effect for internal transfers
                   * and proper accounting for external transfers.
                   */
                  {
                    $and: [
                      !accountId && !customerId && !supplierId && !mazdoorId, // Full Mill view only
                      { $eq: ["$type", "transfer"] },
                      { $in: ["$toAccountId", millAccObjectIdIds] }        // ANY transfer TO mill account
                    ]
                  },
                ],
              },
              "$amount",
              0,
            ],
          },
        },
        totalOut: {
          $sum: {
            $cond: [
              {
                $or: [
                  // Case A: Specific Account selected + Destination=Debit logic
                  { $and: [!!accountId, { $ne: ["$type", "transfer"] }, { $eq: ["$fromAccountId", new mongoose.Types.ObjectId(accountId)] }] },
                  { $and: [!!accountId, { $eq: ["$type", "transfer"] }, { $eq: ["$toAccountId", new mongoose.Types.ObjectId(accountId)] }] },
                  // Case B: Full Mill Summary + money left ANY Mill Account
                  { $and: [!accountId, !customerId && !supplierId && !mazdoorId, { $in: ["$fromAccountId", millAccObjectIdIds] }] },
                  // Case C: Party ledgers
                  { $and: [!!customerId, { $eq: ["$type", "withdraw"] }] },
                  { $and: [!!supplierId, { $eq: ["$type", "withdraw"] }] },
                  { $and: [!!mazdoorId, { $in: ["$type", ["withdraw", "salary"]] }] },
                ],
              },
              "$amount",
              0,
            ],
          },
        },
      },
    },
  ]);

  const openingBalance = baseOpeningBalance + (prevTransactions.length > 0 ? prevTransactions[0].totalIn - prevTransactions[0].totalOut : 0);

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

    console.log("TOTAL TRANSACTIONS:", transactions.length);

// 👇 OPTIONAL (DETAIL CHECK)
transactions.forEach(t => {
  console.log("DATE:", formatDateOnly(t.date), "AMOUNT:", t.amount);
});

  const debug = await Transaction.find(currMatch).lean();

  console.log("===== DEBUG START =====");

  debug.forEach((t) => {
    console.log({
      id: t._id.toString().slice(-6),
      date: formatDateOnly(t.date),
      amount: t.amount,
      type: t.type,
      category: t.category,
      from: t.fromAccountId,
      to: t.toAccountId,
    });
  });

  console.log("===== DEBUG END =====");

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
        if (t.fromAccountId?.showMirrorInDailyMemo !== false) {
          rows.push({ type: "transfer_out", date: formatDateOnly(t.date), name: t.fromAccountId?.name || "Account", description: `Transfer to ${t.toAccountId?.name || "—"}`, accountName: t.fromAccountId?.name || "Manual", amount: t.amount, amountType: "in", isExternal, referenceId: t._id });
        }
        if (t.toAccountId?.showMirrorInDailyMemo !== false) {
          rows.push({ type: "transfer_in", date: formatDateOnly(t.date), name: t.toAccountId?.name || "Account", description: `Transfer from ${t.fromAccountId?.name || "—"}`, accountName: t.toAccountId?.name || "Manual", amount: t.amount, amountType: "out", isExternal, referenceId: t._id });
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
  });
};
