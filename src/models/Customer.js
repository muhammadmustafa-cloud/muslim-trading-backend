import mongoose from 'mongoose';

export const customerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, trim: true, default: '' },
    address: { type: String, trim: true, default: '' },
    notes: { type: String, trim: true, default: '' },
    isAlsoSupplier: { type: Boolean, default: false },
    linkedSupplierId: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', default: null },
    openingBalance: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const getCustomerModel = (conn) => conn.model('Customer', customerSchema);
export default mongoose.model('Customer', customerSchema);

