import mongoose from 'mongoose';

const mazdoorSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, trim: true, default: '' },
    role: { type: String, trim: true, default: '' },
    notes: { type: String, trim: true, default: '' },
    monthlySalary: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

export default mongoose.model('Mazdoor', mazdoorSchema);
