import mongoose from 'mongoose';

const stockEntrySchema = new mongoose.Schema(
  {
    date: { type: Date, required: true, default: () => new Date() },
    itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },
    supplierId: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
    receivedWeight: { type: Number, default: 0, min: 0 },
    kattay: { type: Number, default: 0, min: 0 },
    kgPerKata: { type: Number, default: 0, min: 0 },
    millWeight: { type: Number, default: 0, min: 0 },
    supplierWeight: { type: Number, default: 0, min: 0 },
    rate: { type: Number, default: 0 }, // Rate per MUN (40kg)
    shCut: { type: Number, default: 0 }, // Total S.H Cut weight
    amount: { type: Number, default: 0, min: 0 },
    bardanaAmount: { type: Number, default: 0, min: 0 },
    amountPaid: { type: Number, default: 0 },
    dueDate: { type: Date, default: null },
    paymentStatus: {
      type: String,
      enum: ['pending', 'partial', 'paid'],
      default: 'pending',
    },
    truckNumber: { type: String, trim: true, default: '' },
    accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', default: null },
    notes: { type: String, trim: true, default: '' },
  },
  { timestamps: true }
);

export default mongoose.model('StockEntry', stockEntrySchema);
