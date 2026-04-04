import mongoose from 'mongoose';

export const taxTypeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    description: { type: String, trim: true, default: '' },
  },
  { timestamps: true }
);

export const getTaxTypeModel = (conn) => conn.model('TaxType', taxTypeSchema);
export default mongoose.model('TaxType', taxTypeSchema);

