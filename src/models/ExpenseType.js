import mongoose from 'mongoose';

export const expenseTypeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    description: { type: String, trim: true, default: '' },
  },
  { timestamps: true }
);

export const getExpenseTypeModel = (conn) => conn.model('ExpenseType', expenseTypeSchema);
export default mongoose.model('ExpenseType', expenseTypeSchema);

