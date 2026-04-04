
import { toUTCStartOfDay, buildUTCDateFilter } from '../utils/dateUtils.js';

/**
 * GET ALL DASTI ENTRIES
 */
export const getDastiEntries = async (req, res) => {
  const { DailyDastiEntry } = req.models;
  const { dateFrom, dateTo } = req.query;

  try {
    const filter = buildUTCDateFilter(dateFrom, dateTo);

    const entries = await DailyDastiEntry.find(filter).sort({ date: 1, createdAt: 1 });
    res.status(200).json({ success: true, count: entries.length, data: entries });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * CREATE DASTI ENTRY
 */
export const createDastiEntry = async (req, res) => {
  const { DailyDastiEntry } = req.models;
  const { name, type, amount, date, note } = req.body;

  try {
    if (!name || !type || amount === undefined) {
      return res.status(400).json({ success: false, message: 'Name, Type (credit/debit), and Amount are required.' });
    }

    const dastiDate = toUTCStartOfDay(date);

    const newEntry = await DailyDastiEntry.create({
      name,
      type,
      amount,
      date: dastiDate,
      note: note || '',
    });

    res.status(201).json({ success: true, data: newEntry });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * DELETE DASTI ENTRY
 */
export const deleteDastiEntry = async (req, res) => {
  const { DailyDastiEntry } = req.models;
  const { id } = req.params;

  try {
    const entry = await DailyDastiEntry.findByIdAndDelete(id);
    if (!entry) {
      return res.status(404).json({ success: false, message: 'Dasti entry not found.' });
    }
    res.status(200).json({ success: true, message: 'Dasti entry deleted.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
