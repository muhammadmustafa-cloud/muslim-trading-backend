import { getTenantConnection } from '../config/dbManager.js';
import logger from '../utils/logger.js';

/**
 * Middleware to handle multi-tenancy by extracting x-client-id header.
 * Attaches the connection and models to req object.
 */
export const tenantMiddleware = async (req, res, next) => {
  const clientId = req.headers['x-client-id'];

  // 1. Check if Client ID is provided
  if (!clientId) {
    logger.warn('Request missing x-client-id header');
    return res.status(400).json({
      success: false,
      message: 'Client ID is required (x-client-id header missing)'
    });
  }

  try {
    // 2. Get the connection and pre-built models for this client
    const { conn, models } = await getTenantConnection(clientId);

    // 3. Attach connection and models to the request
    req.db = conn;
    req.models = models;

    next();
  } catch (error) {
    logger.error(`Tenant initialization failed for client ${clientId}:`, error);
    
    // Return appropriate error based on the failure
    if (error.message.includes('Unauthorized') || error.message.includes('configuration missing')) {
      return res.status(403).json({
        success: false,
        message: error.message
      });
    }

    res.status(500).json({
      success: false,
      message: 'Internal Server Error (Database Connection Failed)'
    });
  }
};
