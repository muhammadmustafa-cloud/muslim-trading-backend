import mongoose from 'mongoose';
import Transaction from './models/Transaction.js';

await mongoose.connect('mongodb+srv://systellexdeveloper_db_user:yNDJYRPur32XIdNZ@cluster0.cbmiqh9.mongodb.net/?appName=Cluster0');

const transactions = await Transaction.find().limit(10);

transactions.forEach(t => {
  const utcDate = new Date(t.date);
  const pkDate = new Date(utcDate.getTime() + (5 * 60 * 60 * 1000));
  const formatted = pkDate.toISOString().slice(0, 10);

  console.log({
    old: t.date,
    new: formatted
  });
});

process.exit();