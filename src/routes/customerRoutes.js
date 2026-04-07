import { Router } from 'express';
import { asyncHandler } from '../middlewares/asyncHandler.js';
import * as customerController from '../controllers/customerController.js';
import { protect, superAdminOnly } from '../middleware/authMiddleware.js';

const router = Router();

router.use(protect);

router.get('/', asyncHandler(customerController.list));
router.get('/receivables', asyncHandler(customerController.getReceivables));
router.get('/:id/history', asyncHandler(customerController.getHistory));
router.get('/:id', asyncHandler(customerController.getById));
router.post('/', asyncHandler(customerController.create));
router.put('/:id', asyncHandler(customerController.update));

export default router;
