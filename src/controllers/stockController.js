import mongoose from 'mongoose';

/**
 * Returns current stock per item: sum(stock entry quantity) − sum(sales quantity).
 */
export async function getCurrentStockData(models) {
  const { StockEntry, Sale, Item } = models;
  const [purchases, sales] = await Promise.all([
    StockEntry.aggregate([
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.itemId",
          quantity: { $sum: "$items.itemNetWeight" },
          kattay: { $sum: "$items.kattay" },
        },
      },
    ]),
    Sale.aggregate([
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.itemId",
          quantity: { $sum: "$items.quantity" },
          kattay: { $sum: "$items.kattay" },
        },
      },
    ]),
  ]);

  const stockMap = new Map();

  purchases.forEach((p) => {
    const key = p._id.toString();
    stockMap.set(key, { quantity: p.quantity, kattay: p.kattay });
  });

  sales.forEach((s) => {
    const key = s._id.toString();
    const existing = stockMap.get(key) || { quantity: 0, kattay: 0 };
    stockMap.set(key, {
      quantity: existing.quantity - s.quantity,
      kattay: existing.kattay - s.kattay,
    });
  });

  const items = await Item.find({}).populate("categoryId", "name").lean();

  const result = items.map((item) => {
    const stock = stockMap.get(item._id.toString()) || { quantity: 0, kattay: 0 };
    // Starting point is now the "Opening Stock" entered by the user
    return {
      itemId: item._id,
      itemName: item.name,
      category: item.categoryId?.name || "",
      quality: item.quality || "",
      quantity: Math.max(0, (item.openingWeight || 0) + stock.quantity),
      kattay: Math.max(0, (item.openingBags || 0) + stock.kattay),
    };
  });

  result.sort((a, b) =>
    a.itemName.localeCompare(b.itemName) ||
    (a.category || "").localeCompare(b.category || "") ||
    (a.quality || "").localeCompare(b.quality || "")
  );

  return result;
}

/**
 * Current stock per item — API handler.
 */
export const currentStock = async (req, res) => {
  const data = await getCurrentStockData(req.models);
  res.json({ success: true, data });
};
