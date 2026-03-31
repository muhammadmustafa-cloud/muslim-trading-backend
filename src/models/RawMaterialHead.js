import mongoose from 'mongoose';

const rawMaterialHeadSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
  },
  { timestamps: true }
);

export default mongoose.model('RawMaterialHead', rawMaterialHeadSchema);
