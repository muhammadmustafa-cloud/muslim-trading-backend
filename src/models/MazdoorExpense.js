import mongoose from 'mongoose';

const mazdoorExpenseSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true, default: () => new Date() },
    mazdoorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Mazdoor', required: true },
    mazdoorItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'MazdoorItem', required: true },
    bags: { type: Number, required: true, min: 0 },
    totalAmount: { type: Number, required: true, min: 0 },
    accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
    transactionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', default: null },
  },
  { timestamps: true }
);

export default mongoose.model('MazdoorExpense', mazdoorExpenseSchema);
