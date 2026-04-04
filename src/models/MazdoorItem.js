import mongoose from 'mongoose';

export const mazdoorItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    rate: { type: Number, default: 0, min: 0 },
    notes: { type: String, trim: true, default: '' },
  },
  { timestamps: true }
);

export const getMazdoorItemModel = (conn) => conn.model('MazdoorItem', mazdoorItemSchema);
export default mongoose.model('MazdoorItem', mazdoorItemSchema);

