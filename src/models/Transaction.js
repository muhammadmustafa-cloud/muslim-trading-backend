import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true, default: () => new Date() },
    type: { type: String, enum: ['deposit', 'withdraw', 'transfer', 'accrual', 'salary', 'tax', 'expense'], required: true },
    fromAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', default: null },
    toAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', default: null },
    amount: { type: Number, required: true, min: 0 },
    category: { type: String, trim: true, default: '' },
    note: { type: String, trim: true, default: '' },
    supplierId: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', default: null },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
    mazdoorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Mazdoor', default: null },
    stockEntryId: { type: mongoose.Schema.Types.ObjectId, ref: 'StockEntry', default: null },
    saleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Sale', default: null },
    machineryPurchaseId: { type: mongoose.Schema.Types.ObjectId, ref: 'MachineryPurchase', default: null },
    taxTypeId: { type: mongoose.Schema.Types.ObjectId, ref: 'TaxType', default: null },
    expenseTypeId: { type: mongoose.Schema.Types.ObjectId, ref: 'ExpenseType', default: null },
    rawMaterialHeadId: { type: mongoose.Schema.Types.ObjectId, ref: 'RawMaterialHead', default: null },
    image: { type: String, default: null },
    paymentMethod: { type: String, enum: ['cash', 'online', 'cheque'], default: 'cash' },
    chequeNumber: { type: String, trim: true, default: '' },
    chequeDate: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model('Transaction', transactionSchema);
