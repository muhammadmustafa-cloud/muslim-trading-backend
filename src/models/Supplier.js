import mongoose from 'mongoose';

const supplierSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, trim: true, default: '' },
    address: { type: String, trim: true, default: '' },
    notes: { type: String, trim: true, default: '' },
    isAlsoCustomer: { type: Boolean, default: false },
    linkedCustomerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
    openingBalance: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.model('Supplier', supplierSchema);
