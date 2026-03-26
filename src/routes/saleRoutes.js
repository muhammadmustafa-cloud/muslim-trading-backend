import { Router } from 'express';
import { asyncHandler } from '../middlewares/asyncHandler.js';
import upload from '../middleware/upload.js';
import * as saleController from '../controllers/saleController.js';

const router = Router();

router.get('/available', asyncHandler(saleController.getAvailable));
router.get('/', asyncHandler(saleController.list));
router.get('/:id', asyncHandler(saleController.getById));
router.post('/', upload.single('image'), asyncHandler(saleController.create));
router.put('/:id', upload.single('image'), asyncHandler(saleController.update));
router.post('/:id/collect-payment', asyncHandler(saleController.collectPayment));

export default router;
