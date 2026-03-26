import mongoose from 'mongoose';

const millExpenseSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true, default: () => new Date() },
    amount: { type: Number, required: true, min: 0 },
    category: { type: String, trim: true, default: '' },
    note: { type: String, trim: true, default: '' },
    image: { type: String, default: null },
  },
  { timestamps: true }
);

export default mongoose.model('MillExpense', millExpenseSchema);
