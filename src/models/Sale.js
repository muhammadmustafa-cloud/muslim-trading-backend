import mongoose from 'mongoose';

const saleSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true, default: () => new Date() },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },
    quantity: { type: Number, required: true, min: 0 },
    rate: { type: Number, default: 0 },
    totalAmount: { type: Number, default: 0 },
    truckNumber: { type: String, trim: true, default: '' },
    amountReceived: { type: Number, default: 0 },
    accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', default: null },
    notes: { type: String, trim: true, default: '' },
  },
  { timestamps: true }
);

export default mongoose.model('Sale', saleSchema);
