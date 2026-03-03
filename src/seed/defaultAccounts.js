import Account from '../models/Account.js';
import logger from '../utils/logger.js';

const DEFAULT_ACCOUNTS = [
  { name: 'Daal Khataa', type: 'Cash', isDailyKhata: false, isMillKhata: false },
  { name: 'Mill Khataa', type: 'Cash', isDailyKhata: false, isMillKhata: true },
  { name: 'Daily Khata', type: 'Cash', isDailyKhata: true, isMillKhata: false },
];

/**
 * Ensures default accounts exist. Creates only those that don't exist (by name).
 * Idempotent: safe to run on every server start.
 */
export async function seedDefaultAccounts() {
  try {
    for (const def of DEFAULT_ACCOUNTS) {
      const existing = await Account.findOne({
        name: new RegExp(`^${escapeRegex(def.name)}$`, 'i'),
      });
      if (!existing) {
        await Account.create({
          name: def.name,
          type: def.type,
          openingBalance: 0,
          isDailyKhata: def.isDailyKhata ?? false,
          isMillKhata: def.isMillKhata ?? false,
        });
        logger.info(`Seed: created account "${def.name}"`);
      }
    }
  } catch (err) {
    logger.error('Seed default accounts failed:', err);
    throw err;
  }
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
