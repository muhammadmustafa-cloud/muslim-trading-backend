import StockEntry from '../models/StockEntry.js';
import Sale from '../models/Sale.js';
import Item from '../models/Item.js';
import mongoose from 'mongoose';

/**
 * Returns current stock per item: sum(stock entry quantity) − sum(sales quantity).
 */
export async function getCurrentStockData() {
  const entries = await StockEntry.find({}).lean();
  const byItem = new Map(); // key: itemId.toString() -> { itemId, quantity, kattay }

  for (const entry of entries) {
    if (!entry.itemId) continue;
    const itemId = entry.itemId && typeof entry.itemId === 'object' && entry.itemId._id ? entry.itemId._id : entry.itemId;
    const key = itemId.toString();
    if (!byItem.has(key)) {
      byItem.set(key, { itemId, quantity: 0, kattay: 0, millWeight: 0, supplierWeight: 0 });
    }
    const rec = byItem.get(key);
    rec.quantity += Number(entry.receivedWeight) || 0;
    rec.kattay += Number(entry.kattay) || 0;
    rec.millWeight += Number(entry.millWeight) || 0;
    rec.supplierWeight += Number(entry.supplierWeight) || 0;
  }

  const sales = await Sale.find({}).lean();
  for (const s of sales) {
    if (!s.itemId) continue;
    const itemId = (s.itemId && (s.itemId._id || s.itemId)) ? (s.itemId._id || s.itemId) : s.itemId;
    const key = itemId.toString();
    if (!byItem.has(key)) {
      byItem.set(key, { itemId, quantity: 0, kattay: 0, millWeight: 0, supplierWeight: 0 });
    }
    const saleRec = byItem.get(key);
    saleRec.quantity -= Number(s.quantity) || 0;
    saleRec.kattay -= Number(s.kattay) || 0;
    saleRec.millWeight -= Number(s.quantity) || 0;
    saleRec.supplierWeight -= Number(s.quantity) || 0;
  }

  const items = await Item.find({}).populate('categoryId', 'name').lean();
  const itemMap = new Map(items.map((i) => [i._id.toString(), i]));

  const result = [];
  for (const [, rec] of byItem) {
    const item = itemMap.get(rec.itemId.toString());
    if (!item) continue;
    result.push({
      itemId: item._id,
      itemName: item.name,
      category: item.categoryId?.name || '',
      quality: item.quality || '',
      quantity: Math.max(0, rec.quantity),
      kattay: Math.max(0, rec.kattay),
      millWeight: Math.max(0, rec.millWeight),
      supplierWeight: Math.max(0, rec.supplierWeight),
    });
  }

  result.sort((a, b) => a.itemName.localeCompare(b.itemName) || (a.category || '').localeCompare(b.category || '') || (a.quality || '').localeCompare(b.quality || ''));
  return result;
}

/**
 * Current stock per item — API handler.
 */
export const currentStock = async (req, res) => {
  const data = await getCurrentStockData();
  res.json({ success: true, data });
};
