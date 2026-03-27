import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Sale from '../models/Sale.js';
import StockEntry from '../models/StockEntry.js';
import connectDB from '../config/database.js';

dotenv.config();

/**
 * MIGRATION SCRIPT: Single-Item to Multi-Item Transition
 * 
 * This script wraps existing single-item fields into a new 'items' array
 * to maintain backward compatibility with old data.
 */

async function migrate() {
  try {
    await connectDB();
    console.log('--- Migration Started ---');

    // 1. Migrate Sales
    const sales = await Sale.find({ 
      $or: [
        { items: { $exists: false } },
        { items: { $size: 0 } }
      ]
    });
    console.log(`Found ${sales.length} un-migrated Sales.`);

    for (const sale of sales) {
      if (sale.itemId) {
        const gross = (Number(sale.kattay) || 0) * (Number(sale.kgPerKata) || 0) || (Number(sale.quantity) || 0);
        sale.items = [{
          itemId: sale.itemId,
          kattay: Number(sale.kattay) || 0,
          kgPerKata: Number(sale.kgPerKata) || 0,
          grossWeight: gross,
          shCut: Number(sale.shCut) || 0,
          quantity: Number(sale.quantity) || 0,
          rate: Number(sale.rate) || 0,
          bardanaRate: Number(sale.bardanaRate) || 0,
          bardanaAmount: Number(sale.bardanaAmount) || 0,
          mazdori: Number(sale.mazdori) || 0,
          totalAmount: Number(sale.totalAmount) || 0
        }];
        sale.totalGrossWeight = gross;
        sale.totalSHCut = Number(sale.shCut) || 0;
        sale.netWeight = Number(sale.quantity) || 0;
        
        // Mark as modified if necessary
        sale.markModified('items');
        await sale.save();
      }
    }
    console.log('✅ Sales Migration Complete.');

    // 2. Migrate StockEntries (Purchases)
    const stockEntries = await StockEntry.find({
      $or: [
        { items: { $exists: false } },
        { items: { $size: 0 } }
      ]
    });
    console.log(`Found ${stockEntries.length} un-migrated Stock Entries.`);

    for (const entry of stockEntries) {
      if (entry.itemId) {
        const gross = (Number(entry.kattay) || 0) * (Number(entry.kgPerKata) || 0) || (Number(entry.receivedWeight) || 0);
        entry.items = [{
          itemId: entry.itemId,
          kattay: Number(entry.kattay) || 0,
          kgPerKata: Number(entry.kgPerKata) || 0,
          grossWeight: gross,
          shCut: Number(entry.shCut) || 0,
          itemNetWeight: Number(entry.receivedWeight) || 0,
          rate: Number(entry.rate) || 0,
          bardanaAmount: Number(entry.bardanaAmount) || 0,
          amount: Number(entry.amount) || 0
        }];
        entry.totalGrossWeight = gross;
        entry.totalSHCut = Number(entry.shCut) || 0;
        entry.receivedWeight = Number(entry.receivedWeight) || 0;
        
        entry.markModified('items');
        await entry.save();
      }
    }
    console.log('✅ StockEntries Migration Complete.');

    console.log('--- Migration Finished Successfully ---');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration Failed:', error);
    process.exit(1);
  }
}

migrate();
