import mongoose from 'mongoose';

const outputSchema = new mongoose.Schema(
  {
    partId: { type: mongoose.Schema.Types.ObjectId, required: true },
    quantity: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const stockEntrySchema = new mongoose.Schema(
  {
    date: { type: Date, required: true, default: () => new Date() },
    itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },
    supplierId: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
    receivedWeight: { type: Number, default: 0, min: 0 },
    kattay: { type: Number, default: 0, min: 0 },
    kgPerKata: { type: Number, default: 0, min: 0 },
    amount: { type: Number, default: 0, min: 0 },
    amountPaid: { type: Number, default: 0 },
    accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', default: null },
    notes: { type: String, trim: true, default: '' },
    outputs: [outputSchema],
  },
  { timestamps: true }
);

export default mongoose.model('StockEntry', stockEntrySchema);
