import mongoose from 'mongoose';

export const machineryPurchaseSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true, default: () => new Date() },
    machineryItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'MachineryItem', required: true },
    supplierId: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
    accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
    amount: { type: Number, required: true, min: 0 },
    quantity: { type: Number, default: 1 },
    note: { type: String, trim: true, default: '' },
    transactionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', default: null },
  },
  { timestamps: true }
);

export const getMachineryPurchaseModel = (conn) => conn.model('MachineryPurchase', machineryPurchaseSchema);
export default mongoose.model('MachineryPurchase', machineryPurchaseSchema);

