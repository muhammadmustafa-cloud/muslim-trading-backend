import { Router } from 'express';
import customerRoutes from './customerRoutes.js';
import supplierRoutes from './supplierRoutes.js';
import mazdoorRoutes from './mazdoorRoutes.js';
import accountRoutes from './accountRoutes.js';
import itemRoutes from './itemRoutes.js';
import stockEntryRoutes from './stockEntryRoutes.js';
import stockRoutes from './stockRoutes.js';
import saleRoutes from './saleRoutes.js';
import transactionRoutes from './transactionRoutes.js';
import dashboardRoutes from './dashboardRoutes.js';

const router = Router();

router.use('/customers', customerRoutes);
router.use('/suppliers', supplierRoutes);
router.use('/mazdoor', mazdoorRoutes);
router.use('/accounts', accountRoutes);
router.use('/items', itemRoutes);
router.use('/stock-entries', stockEntryRoutes);
router.use('/stock', stockRoutes);
router.use('/sales', saleRoutes);
router.use('/transactions', transactionRoutes);
router.use('/dashboard', dashboardRoutes);

// Base API info
router.get('/', (req, res) => {
  res.json({ message: 'Mill API', version: '1.0.0' });
});

export default router;
