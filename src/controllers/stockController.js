import StockEntry from '../models/StockEntry.js';
import Sale from '../models/Sale.js';
import Item from '../models/Item.js';
import mongoose from 'mongoose';

/**
 * Returns current stock per part: sum(stock entry outputs) − sum(sales).
 * Reusable for API and dashboard.
 */
export async function getCurrentStockData() {
  const entries = await StockEntry.find({}).lean();
  const byPart = new Map(); // key: partId.toString() -> { partId, itemId, quantity }

  for (const entry of entries) {
    if (!entry.outputs || !entry.itemId) continue;
    const itemId = entry.itemId && typeof entry.itemId === 'object' && entry.itemId._id ? entry.itemId._id : entry.itemId;
    for (const o of entry.outputs) {
      const key = o.partId.toString();
      if (!byPart.has(key)) {
        byPart.set(key, { partId: o.partId, itemId, quantity: 0 });
      }
      const rec = byPart.get(key);
      rec.quantity += Number(o.quantity) || 0;
    }
  }

  const sales = await Sale.find({}).lean();
  for (const s of sales) {
    if (!s.partId) continue;
    const key = s.partId.toString();
    if (byPart.has(key)) {
      byPart.get(key).quantity -= Number(s.quantity) || 0;
    }
  }

  const items = await Item.find({}).lean();
  const itemMap = new Map(items.map((i) => [i._id.toString(), i]));

  const result = [];
  for (const [, rec] of byPart) {
    const item = itemMap.get(rec.itemId.toString());
    if (!item) continue;
    const part = (item.parts || []).find((p) => p._id.toString() === rec.partId.toString());
    if (!part) continue;
    result.push({
      itemId: item._id,
      itemName: item.name,
      partId: rec.partId,
      partName: part.partName,
      unit: part.unit || 'kg',
      quantity: Math.max(0, rec.quantity),
    });
  }

  result.sort((a, b) => a.itemName.localeCompare(b.itemName) || a.partName.localeCompare(b.partName));
  return result;
}

/**
 * Current stock per part — API handler.
 */
export const currentStock = async (req, res) => {
  const data = await getCurrentStockData();
  res.json({ success: true, data });
};
