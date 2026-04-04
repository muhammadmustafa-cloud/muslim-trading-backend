import mongoose from 'mongoose';

export const rawMaterialHeadSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
  },
  { timestamps: true }
);

export const getRawMaterialHeadModel = (conn) => conn.model('RawMaterialHead', rawMaterialHeadSchema);
export default mongoose.model('RawMaterialHead', rawMaterialHeadSchema);

