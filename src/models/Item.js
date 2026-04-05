import mongoose from 'mongoose';

export const itemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
    quality: { type: String, trim: true, default: '' },
    openingBags: { type: Number, default: 0 },
    openingWeight: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const getItemModel = (conn) => conn.model('Item', itemSchema);
export default mongoose.model('Item', itemSchema);

