import { Router } from 'express';
import { asyncHandler } from '../middlewares/asyncHandler.js';
import upload from '../middleware/upload.js';
import * as stockEntryController from '../controllers/stockEntryController.js';
import { protect, superAdminOnly } from '../middleware/authMiddleware.js';

const router = Router();

router.get('/', protect, asyncHandler(stockEntryController.list));
router.get('/pending', protect, asyncHandler(stockEntryController.listPending));
router.get('/:id', protect, asyncHandler(stockEntryController.getById));
router.post('/', protect, upload.single('image'), asyncHandler(stockEntryController.create));
router.put('/:id', protect, superAdminOnly, upload.single('image'), asyncHandler(stockEntryController.update));
router.post('/:id/pay', protect, asyncHandler(stockEntryController.payEntry));

export default router;
