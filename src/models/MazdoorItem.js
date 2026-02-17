import mongoose from 'mongoose';

const mazdoorItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    rate: { type: Number, default: 0, min: 0 },
    notes: { type: String, trim: true, default: '' },
  },
  { timestamps: true }
);

export default mongoose.model('MazdoorItem', mazdoorItemSchema);
