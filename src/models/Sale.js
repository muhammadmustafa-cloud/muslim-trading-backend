import mongoose from 'mongoose';

const saleSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true, default: () => new Date() },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },

    // Kattay-based fields (professional granular tracking)
    kattay: { type: Number, default: 0 },
    kgPerKata: { type: Number, default: 0 },

    quantity: { type: Number, required: true, min: 0 },       // Total weight (kg) = kattay × kgPerKata - shCut
    shCut: { type: Number, default: 0, min: 0 },               // Short cut weight deduction
    bardanaRate: { type: Number, default: 0, min: 0 },         // Rate per bag for bardana
    bardanaAmount: { type: Number, default: 0, min: 0 },       // Normally kattay * bardanaRate
    mazdori: { type: Number, default: 0, min: 0 },             // Labor charges
    rate: { type: Number, default: 0 },                        // Rate per MUN (legacy fallback as per kg)
    totalAmount: { type: Number, default: 0 },                 // Total bill
    truckNumber: { type: String, trim: true, default: '' },
    amountReceived: { type: Number, default: 0 },
    accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', default: null },
    notes: { type: String, trim: true, default: '' },

    // Payment & Audit fields (mirroring StockEntry)
    dueDate: { type: Date, default: null },
    paymentStatus: { type: String, enum: ['pending', 'partial', 'paid'], default: 'pending' },
  },
  { timestamps: true }
);

export default mongoose.model('Sale', saleSchema);
