import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true, default: () => new Date() },
    type: { type: String, enum: ['deposit', 'withdraw', 'transfer'], required: true },
    fromAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', default: null },
    toAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', default: null },
    amount: { type: Number, required: true, min: 0 },
    category: { type: String, trim: true, default: '' },
    note: { type: String, trim: true, default: '' },
    supplierId: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', default: null },
    mazdoorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Mazdoor', default: null },
    stockEntryId: { type: mongoose.Schema.Types.ObjectId, ref: 'StockEntry', default: null },
    saleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Sale', default: null },
  },
  { timestamps: true }
);

export default mongoose.model('Transaction', transactionSchema);
