import mongoose from 'mongoose';

export const scannedDocumentSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    documentType: {
      type: String,
      enum: ['SignatureBook', 'DailyCashMemo'],
      required: true,
    },
    imageUrl: {
      type: String,
      required: true, // This will store the base64 string
    },
    recordDate: {
      type: Date,
      required: true,
    },
    notes: {
      type: String,
      default: '',
    },
  },
  { timestamps: true }
);

// We export the schema, but model registration is handled centrally
