import { userSchema } from './User.js';
import { customerSchema } from './Customer.js';
import { supplierSchema } from './Supplier.js';
import { saleSchema } from './Sale.js';
import { stockEntrySchema } from './StockEntry.js';
import { transactionSchema } from './Transaction.js';
import { accountSchema } from './Account.js';
import { itemSchema } from './Item.js';
import { categorySchema } from './Category.js';
import { dailyDastiEntrySchema } from './DailyDastiEntry.js';
import { expenseTypeSchema } from './ExpenseType.js';
import { machineryItemSchema } from './MachineryItem.js';
import { machineryPurchaseSchema } from './MachineryPurchase.js';
import { mazdoorSchema } from './Mazdoor.js';
import { mazdoorExpenseSchema } from './MazdoorExpense.js';
import { mazdoorItemSchema } from './MazdoorItem.js';
import { millExpenseSchema } from './MillExpense.js';
import { rawMaterialHeadSchema } from './RawMaterialHead.js';
import { taxTypeSchema } from './TaxType.js';

export const registerAllModels = (conn) => {
  const modelDefinitions = [
    { name: 'User', schema: userSchema },
    { name: 'Customer', schema: customerSchema },
    { name: 'Supplier', schema: supplierSchema },
    { name: 'Sale', schema: saleSchema },
    { name: 'StockEntry', schema: stockEntrySchema },
    { name: 'Transaction', schema: transactionSchema },
    { name: 'Account', schema: accountSchema },
    { name: 'Item', schema: itemSchema },
    { name: 'Category', schema: categorySchema },
    { name: 'DailyDastiEntry', schema: dailyDastiEntrySchema },
    { name: 'ExpenseType', schema: expenseTypeSchema },
    { name: 'MachineryItem', schema: machineryItemSchema },
    { name: 'MachineryPurchase', schema: machineryPurchaseSchema },
    { name: 'Mazdoor', schema: mazdoorSchema },
    { name: 'MazdoorExpense', schema: mazdoorExpenseSchema },
    { name: 'MazdoorItem', schema: mazdoorItemSchema },
    { name: 'MillExpense', schema: millExpenseSchema },
    { name: 'RawMaterialHead', schema: rawMaterialHeadSchema },
    { name: 'TaxType', schema: taxTypeSchema },
  ];

  modelDefinitions.forEach(({ name, schema }) => {
    if (!conn.models[name]) {
      conn.model(name, schema);
    }
  });
  
  return conn;
};
