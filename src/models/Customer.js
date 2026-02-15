import mongoose from 'mongoose';

const customerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, trim: true, default: '' },
    address: { type: String, trim: true, default: '' },
    notes: { type: String, trim: true, default: '' },
    isAlsoSupplier: { type: Boolean, default: false },
    linkedSupplierId: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', default: null },
  },
  { timestamps: true }
);

export default mongoose.model('Customer', customerSchema);
