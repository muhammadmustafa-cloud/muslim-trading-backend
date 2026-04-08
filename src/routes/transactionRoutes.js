import { Router } from 'express';
import { asyncHandler } from '../middlewares/asyncHandler.js';
import upload from '../middleware/upload.js';
import * as transactionController from '../controllers/transactionController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = Router();

router.get('/', protect, asyncHandler(transactionController.list));
router.get('/:id', protect, asyncHandler(transactionController.getById));
router.post('/', protect, upload.single('image'), asyncHandler(transactionController.create));
router.put('/:id', protect, upload.single('image'), asyncHandler(transactionController.update));
router.delete('/:id', protect, asyncHandler(transactionController.remove));

export default router;
