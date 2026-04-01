/**
 * Standardizes date handling for the ERP.
 * MongoDB stores in UTC. To ensure the database 'looks' correct (showing the same date as ERP),
 * we shift all dates to UTC 00:00:00.000 for that specific calendar day.
 */

/**
 * Normalizes any date string (YYYY-MM-DD) or Date object to UTC Start of Day.
 * @param {string|Date} date 
 * @returns {Date}
 */
export const toUTCStartOfDay = (date) => {
  if (!date) return new Date(new Date().toISOString().split('T')[0] + 'T00:00:00.000Z');
  
  const dateStr = typeof date === 'string' ? date.substring(0, 10) : date.toISOString().split('T')[0];
  return new Date(`${dateStr}T00:00:00.000Z`);
};

/**
 * Returns UTC End of Day for a given date string.
 * @param {string} dateStr 
 * @returns {Date}
 */
export const toUTCEndOfDay = (dateStr) => {
  if (!dateStr) return null;
  const cleanDate = dateStr.substring(0, 10);
  return new Date(`${cleanDate}T23:59:59.999Z`);
};

/**
 * Build Mongoose date filter for range [from, to] in UTC.
 * @param {string} from 
 * @param {string} to 
 * @returns {object}
 */
export const buildUTCDateFilter = (from, to) => {
  const filter = {};
  if (from || to) {
    filter.date = {};
    if (from) filter.date.$gte = toUTCStartOfDay(from);
    if (to) filter.date.$lte = toUTCEndOfDay(to);
  }
  return filter;
};
