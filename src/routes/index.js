import { Router } from 'express';
import customerRoutes from './customerRoutes.js';
import supplierRoutes from './supplierRoutes.js';
import mazdoorRoutes from './mazdoorRoutes.js';
import mazdoorItemRoutes from './mazdoorItemRoutes.js';
import mazdoorExpenseRoutes from './mazdoorExpenseRoutes.js';
import accountRoutes from './accountRoutes.js';
import categoryRoutes from './categoryRoutes.js';
import itemRoutes from './itemRoutes.js';
import stockEntryRoutes from './stockEntryRoutes.js';
import stockRoutes from './stockRoutes.js';
import saleRoutes from './saleRoutes.js';
import transactionRoutes from './transactionRoutes.js';
import dashboardRoutes from './dashboardRoutes.js';
import dailyMemoRoutes from './dailyMemoRoutes.js';
import dailyDastiRoutes from './dailyDastiRoutes.js';
import millExpenseRoutes from './millExpenseRoutes.js';
import machineryItemRoutes from './machineryItemRoutes.js';
import machineryPurchaseRoutes from './machineryPurchaseRoutes.js';
import taxTypeRoutes from './taxTypeRoutes.js';
import expenseTypeRoutes from './expenseTypeRoutes.js';
import authRoutes from './authRoutes.js';
import auditRoutes from './auditRoutes.js';
import userRoutes from './userRoutes.js';
import rawMaterialHeadRoutes from './rawMaterialHeadRoutes.js';

const router = Router();

router.use('/customers', customerRoutes);
router.use('/suppliers', supplierRoutes);
router.use('/mazdoor', mazdoorRoutes);
router.use('/mazdoor-items', mazdoorItemRoutes);
router.use('/mazdoor-expenses', mazdoorExpenseRoutes);
router.use('/accounts', accountRoutes);
router.use('/categories', categoryRoutes);
router.use('/items', itemRoutes);
router.use('/stock-entries', stockEntryRoutes);
router.use('/stock', stockRoutes);
router.use('/sales', saleRoutes);
router.use('/transactions', transactionRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/daily-memo', dailyMemoRoutes);
router.use('/daily-dasti', dailyDastiRoutes);
router.use('/mill-expenses', millExpenseRoutes);
router.use('/machinery-items', machineryItemRoutes);
router.use('/machinery-purchases', machineryPurchaseRoutes);
router.use('/tax-types', taxTypeRoutes);
router.use('/expense-types', expenseTypeRoutes);
router.use('/audit', auditRoutes);
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/raw-material-heads', rawMaterialHeadRoutes);

// Base API info
router.get('/', (req, res) => {
  res.json({ message: 'Mill API', version: '1.0.0' });
});

export default router;
