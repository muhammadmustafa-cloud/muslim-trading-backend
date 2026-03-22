import mongoose from 'mongoose';

const machineryItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    quality: { type: String, trim: true, default: '' },
    description: { type: String, trim: true, default: '' },
  },
  { timestamps: true }
);

export default mongoose.model('MachineryItem', machineryItemSchema);
