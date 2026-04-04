import mongoose from 'mongoose';
import { config } from './index.js';
import { createModelDefinitions } from '../models/index.js';
import { seedAdminUser } from '../seed/adminSeed.js';
import { seedDefaultAccounts } from '../seed/defaultAccounts.js';
import logger from '../utils/logger.js';
import { registerAllModels } from '../models/modelRegistry.js';

const connections = new Map();

/**
 * Gets a database connection for a specific client.
 * Registers models on the connection if they don't exist.
 */
export const getTenantConnection = async (clientId) => {
  if (connections.has(clientId)) {
    return connections.get(clientId);
  }

  // 1. Validate Client ID against Allowed List
  if (!config.allowedClients.includes(clientId)) {
    throw new Error(`Unauthorized Client ID: ${clientId}`);
  }

  // 2. Get URI for this client
  const envVarName = `MONGO_URI_${clientId.toUpperCase()}`;
  const uri = process.env[envVarName];

  if (!uri) {
    throw new Error(`Database configuration missing for client: ${clientId}`);
  }

  try {
    // 3. Create Connection
    const conn = await mongoose.createConnection(uri, config.mongo.options).asPromise();
    
    // 4. Register Models on this connection
    registerAllModels(conn);
    const models = createModelDefinitions(conn);
    
    // 5. Cache and return
    connections.set(clientId, { conn, models });
    logger.info(`Connection established and cached for client: ${clientId}`);

    // 6. Run initial seeds (idempotent)
    try {
      await seedDefaultAccounts(models);
      await seedAdminUser(models);
    } catch (seedError) {
      logger.error(`Seeding failed for client ${clientId}:`, seedError);
      // We don't fail the whole request because the DB is connected, 
      // but we log the error.
    }
    
    return { conn, models };
  } catch (error) {
    logger.error(`Error connecting to tenant database (${clientId}):`, error);
    throw error;
  }
};

