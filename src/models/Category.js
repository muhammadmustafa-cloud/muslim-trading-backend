import mongoose from 'mongoose';

export const categorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const getCategoryModel = (conn) => conn.model('Category', categorySchema);
export default mongoose.model('Category', categorySchema);

