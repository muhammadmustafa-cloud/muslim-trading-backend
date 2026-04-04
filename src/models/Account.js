import mongoose from 'mongoose';

export const accountSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ['Bank', 'Cash'], default: 'Cash' },
    accountNumber: { type: String, trim: true, default: '' },
    openingBalance: { type: Number, default: 0 },
    notes: { type: String, trim: true, default: '' },
    isDailyKhata: { type: Boolean, default: false },
    isMillKhata: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const getAccountModel = (conn) => conn.model('Account', accountSchema);
export default mongoose.model('Account', accountSchema);

