import mongoose from 'mongoose';

export const mazdoorSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, trim: true, default: '' },
    role: { type: String, trim: true, default: '' },
    notes: { type: String, trim: true, default: '' },
    monthlySalary: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

export const getMazdoorModel = (conn) => conn.model('Mazdoor', mazdoorSchema);
export default mongoose.model('Mazdoor', mazdoorSchema);

