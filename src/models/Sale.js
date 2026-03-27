import mongoose from 'mongoose';

const saleSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true, default: () => new Date() },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    
    // Master weights for the whole load/truck
    totalGrossWeight: { type: Number, default: 0 },
    totalSHCut: { type: Number, default: 0 },
    netWeight: { type: Number, default: 0 }, // totalGrossWeight - totalSHCut

    items: [{
      itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },
      kattay: { type: Number, default: 0 },
      kgPerKata: { type: Number, default: 0 },
      grossWeight: { type: Number, default: 0 }, // Individual line gross
      shCut: { type: Number, default: 0 },       // Individual line S.H Cut
      quantity: { type: Number, default: 0 },    // Individual line Net (kg)
      rate: { type: Number, default: 0 },        // Rate per MUN (40kg)
      bardanaRate: { type: Number, default: 0 },
      bardanaAmount: { type: Number, default: 0 },
      mazdori: { type: Number, default: 0 },
      totalAmount: { type: Number, default: 0 }
    }],

    truckNumber: { type: String, trim: true, default: '' },
    gatePassNo: { type: String, trim: true, default: '' },
    goods: { type: String, trim: true, default: '' },
    image: { type: String, default: null },
    
    amountReceived: { type: Number, default: 0 },
    totalAmount: { type: Number, default: 0 }, // Grand total sum of all items
    
    accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', default: null },
    notes: { type: String, trim: true, default: '' },
    dueDate: { type: Date, default: null },
    paymentStatus: { type: String, enum: ['pending', 'partial', 'paid'], default: 'pending' },
  },
  { timestamps: true }
);

export default mongoose.model('Sale', saleSchema);
