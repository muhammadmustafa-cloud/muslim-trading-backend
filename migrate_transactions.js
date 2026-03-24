import mongoose from 'mongoose';
import Sale from './src/models/Sale.js';
import StockEntry from './src/models/StockEntry.js';
import Transaction from './src/models/Transaction.js';
import dotenv from 'dotenv';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/mill-management';

async function migrate() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB for migration...');

    // 1. Migrate Sales
    const sales = await Sale.find({ amountReceived: { $gt: 0 }, accountId: { $ne: null } });
    console.log(`Found ${sales.length} sales with payments to check...`);
    
    let saleTransCreated = 0;
    for (const s of sales) {
      const exists = await Transaction.findOne({ saleId: s._id, category: 'Sale Collection' });
      if (!exists) {
        await Transaction.create({
          date: s.date,
          type: 'deposit',
          toAccountId: s.accountId,
          amount: s.amountReceived,
          category: 'Sale Collection',
          note: `Legacy: Payment for Sale #${s._id.toString().slice(-6).toUpperCase()}`,
          saleId: s._id,
          customerId: s.customerId,
        });
        saleTransCreated++;
      }
    }
    console.log(`Created ${saleTransCreated} missing transactions for Sales.`);

    // 2. Migrate StockEntries
    const stocks = await StockEntry.find({ amountPaid: { $gt: 0 }, accountId: { $ne: null } });
    console.log(`Found ${stocks.length} purchases with payments to check...`);

    let stockTransCreated = 0;
    for (const s of stocks) {
      const exists = await Transaction.findOne({ stockEntryId: s._id, category: 'Supplier Payment' });
      if (!exists) {
        await Transaction.create({
          date: s.date,
          type: 'withdraw',
          fromAccountId: s.accountId,
          amount: s.amountPaid,
          category: 'Supplier Payment',
          note: `Legacy: Payment for Purchase #${s._id.toString().slice(-6).toUpperCase()}`,
          stockEntryId: s._id,
          supplierId: s.supplierId,
        });
        stockTransCreated++;
      }
    }
    console.log(`Created ${stockTransCreated} missing transactions for Purchases.`);

    console.log('Migration completed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

migrate();
