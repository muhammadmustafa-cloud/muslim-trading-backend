import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { createModelDefinitions } from '../models/index.js';
import { registerAllModels } from '../models/modelRegistry.js';

dotenv.config();

const allowedClients = (process.env.ALLOWED_CLIENTS || '').split(',').map(c => c.trim()).filter(Boolean);

async function fixClientData(clientId) {
  const envVarName = `MONGO_URI_${clientId.toUpperCase()}`;
  const uri = process.env[envVarName];

  if (!uri) {
    console.log(`[${clientId}] Skip: No URI found.`);
    return;
  }

  console.log(`[${clientId}] Connecting to ${uri.split('@')[1] || 'local'}...`);
  
  try {
    const conn = await mongoose.createConnection(uri).asPromise();
    registerAllModels(conn);
    const { StockEntry } = createModelDefinitions(conn);

    const entries = await StockEntry.find({});
    console.log(`[${clientId}] Found ${entries.length} stock entries.`);

    let fixedCount = 0;
    for (const entry of entries) {
      const correctAmount = entry.items.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
      
      if (entry.amount !== correctAmount) {
        const oldAmount = entry.amount;
        entry.amount = correctAmount;
        
        // Recalculate status
        if (entry.amountPaid >= entry.amount && entry.amount > 0) entry.paymentStatus = 'paid';
        else if (entry.amountPaid > 0) entry.paymentStatus = 'partial';
        else entry.paymentStatus = 'pending';

        await entry.save();
        console.log(`[${clientId}] Fixed entry ${entry._id}: ${oldAmount} -> ${correctAmount}`);
        fixedCount++;
      }
    }

    console.log(`[${clientId}] Done. Fixed ${fixedCount} entries.`);
    await conn.close();
  } catch (error) {
    console.error(`[${clientId}] Error:`, error.message);
  }
}

async function run() {
  console.log('Starting migration to fix StockEntry amounts...');
  for (const client of allowedClients) {
    await fixClientData(client);
  }
  console.log('Migration finished.');
  process.exit(0);
}

run();
