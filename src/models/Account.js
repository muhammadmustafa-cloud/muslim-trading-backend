import mongoose from 'mongoose';

const accountSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ['Bank', 'Cash'], default: 'Cash' },
    accountNumber: { type: String, trim: true, default: '' },
    openingBalance: { type: Number, default: 0 },
    notes: { type: String, trim: true, default: '' },
  },
  { timestamps: true }
);

export default mongoose.model('Account', accountSchema);
