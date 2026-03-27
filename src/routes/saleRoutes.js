import { Router } from 'express';
import { asyncHandler } from '../middlewares/asyncHandler.js';
import upload from '../middleware/upload.js';
import * as saleController from '../controllers/saleController.js';
import { protect, superAdminOnly } from '../middleware/authMiddleware.js';

const router = Router();

router.get('/available', protect, asyncHandler(saleController.getAvailable));
router.get('/', protect, asyncHandler(saleController.list));
router.get('/:id', protect, asyncHandler(saleController.getById));
router.post('/', protect, upload.single('image'), asyncHandler(saleController.create));
router.put('/:id', protect, superAdminOnly, upload.single('image'), asyncHandler(saleController.update));
router.post('/:id/collect-payment', protect, asyncHandler(saleController.collectPayment));

export default router;
