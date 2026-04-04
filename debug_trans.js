import mongoose from 'mongoose';
import fs from 'fs';

const AccountSchema = new mongoose.Schema({ name: String });
const Account = mongoose.model('Account', AccountSchema);

const TransactionSchema = new mongoose.Schema({
  amount: Number,
  type: String,
  note: String,
  date: Date,
  fromAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account' },
  toAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account' }
}, { collection: 'transactions' });
const Transaction = mongoose.model('Transaction', TransactionSchema);

async function check() {
  const MONGO_URI = 'mongodb+srv://systellexdeveloper_db_user:yNDJYRPur32XIdNZ@cluster0.cbmiqh9.mongodb.net/?appName=Cluster0';
  await mongoose.connect(MONGO_URI);
  
  const dateFrom = new Date('2026-03-26T00:00:00.000Z');
  const dateTo = new Date('2026-03-26T23:59:59.999Z');
  
  let output = `Checking between ${dateFrom.toISOString()} and ${dateTo.toISOString()}\n`;
  
  const trans = await Transaction.find({
    date: { $gte: dateFrom, $lte: dateTo }
  }).populate('fromAccountId toAccountId').lean();
  
  output += '\n--- Transactions for March 26, 2026 ---\n';
  trans.forEach(t => {
    output += `ID: ${t._id}, Type: ${t.type}, Amount: ${t.amount}, Note: ${t.note}, From: ${t.fromAccountId?.name}, To: ${t.toAccountId?.name}, FullDate: ${t.date.toISOString()}\n`;
  });

  const allAround = await Transaction.find({
    date: { $gte: new Date('2026-03-25T00:00:00.000Z'), $lte: new Date('2026-03-27T23:59:59.999Z') }
  }).populate('fromAccountId toAccountId').lean();

  output += '\n--- Potential 580k Matches ---\n';
  allAround.forEach(t => {
    if (t.amount === 580000) {
        output += `MATCH 580k: ID: ${t._id}, Date: ${t.date.toISOString()}, Type: ${t.type}, From: ${t.fromAccountId?.name}, To: ${t.toAccountId?.name}\n`;
    }
  });

  fs.writeFileSync('./trans_output.txt', output);
  await mongoose.disconnect();
}
check();
