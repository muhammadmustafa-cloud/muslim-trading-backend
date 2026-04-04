/**
 * createModelDefinitions(conn)
 *
 * After registerAllModels(conn) has been called, this returns a plain
 * object mapping every model name to its Mongoose model bound to
 * the tenant-specific connection. Controllers destructure from this
 * object via req.models.
 */
export const createModelDefinitions = (conn) => ({
  User:              conn.model('User'),
  Customer:          conn.model('Customer'),
  Supplier:          conn.model('Supplier'),
  Sale:              conn.model('Sale'),
  StockEntry:        conn.model('StockEntry'),
  Transaction:       conn.model('Transaction'),
  Account:           conn.model('Account'),
  Item:              conn.model('Item'),
  Category:          conn.model('Category'),
  DailyDastiEntry:   conn.model('DailyDastiEntry'),
  ExpenseType:       conn.model('ExpenseType'),
  MachineryItem:     conn.model('MachineryItem'),
  MachineryPurchase: conn.model('MachineryPurchase'),
  Mazdoor:           conn.model('Mazdoor'),
  MazdoorExpense:    conn.model('MazdoorExpense'),
  MazdoorItem:       conn.model('MazdoorItem'),
  MillExpense:       conn.model('MillExpense'),
  RawMaterialHead:   conn.model('RawMaterialHead'),
  TaxType:           conn.model('TaxType'),
});
