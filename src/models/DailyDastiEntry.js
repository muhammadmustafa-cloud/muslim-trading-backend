import mongoose from 'mongoose';

export const dailyDastiEntrySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ['credit', 'debit'], required: true },
    amount: { type: Number, required: true, min: 0 },
    date: { type: Date, required: true, default: Date.now },
    note: { type: String, trim: true, default: '' },
  },
  { timestamps: true }
);

export const getDailyDastiEntryModel = (conn) => conn.model('DailyDastiEntry', dailyDastiEntrySchema);
export default mongoose.model('DailyDastiEntry', dailyDastiEntrySchema);

