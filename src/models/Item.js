import mongoose from 'mongoose';

const partSchema = new mongoose.Schema(
  {
    partName: { type: String, required: true, trim: true },
    unit: { type: String, trim: true, default: 'kg' },
  },
  { _id: true }
);

const itemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    unit: { type: String, trim: true, default: 'kg' },
    parts: [partSchema],
  },
  { timestamps: true }
);

export default mongoose.model('Item', itemSchema);
