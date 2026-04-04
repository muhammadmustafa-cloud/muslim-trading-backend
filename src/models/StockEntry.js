import mongoose from 'mongoose';

export const stockEntrySchema = new mongoose.Schema(
  {
    date: { type: Date, required: true, default: () => new Date() },
    supplierId: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
    
    // Master weights for the whole load/truck
    totalGrossWeight: { type: Number, default: 0 },
    totalSHCut: { type: Number, default: 0 },
    receivedWeight: { type: Number, default: 0 }, // totalGrossWeight - totalSHCut

    items: [{
      itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },
      kattay: { type: Number, default: 0 },
      kgPerKata: { type: Number, default: 0 },
      grossWeight: { type: Number, default: 0 }, // Individual line gross
      shCut: { type: Number, default: 0 },       // Individual line S.H Cut
      itemNetWeight: { type: Number, default: 0 }, // Individual line Net (kg)
      rate: { type: Number, default: 0 },          // Rate per MUN (40kg)
      bardanaAmount: { type: Number, default: 0 },
      amount: { type: Number, default: 0 },
      deductionKg: { type: Number, default: 0 },
      addKg: { type: Number, default: 0 }
    }],

    millWeight: { type: Number, default: 0 },
    supplierWeight: { type: Number, default: 0 },
    
    amountPaid: { type: Number, default: 0 },
    totalBardanaAmount: { type: Number, default: 0 },
    totalMazdori: { type: Number, default: 0 },
    extras: { type: Number, default: 0 },
    amount: { type: Number, default: 0 }, // Grand total sum of all items + bardana + mazdori - extras

    dueDate: { type: Date, default: null },
    paymentStatus: { type: String, enum: ['pending', 'partial', 'paid'], default: 'pending' },
    
    truckNumber: { type: String, trim: true, default: '' },
    gatePassNo: { type: String, trim: true, default: '' },
    goods: { type: String, trim: true, default: '' },
    image: { type: String, default: null },
    accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', default: null },
    notes: { type: String, trim: true, default: '' },
  },
  { timestamps: true }
);

export const getStockEntryModel = (conn) => conn.model('StockEntry', stockEntrySchema);
export default mongoose.model('StockEntry', stockEntrySchema);
