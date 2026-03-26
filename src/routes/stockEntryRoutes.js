import { Router } from 'express';
import { asyncHandler } from '../middlewares/asyncHandler.js';
import upload from '../middleware/upload.js';
import * as stockEntryController from '../controllers/stockEntryController.js';

const router = Router();

router.get('/', asyncHandler(stockEntryController.list));
router.get('/pending', asyncHandler(stockEntryController.listPending));
router.get('/:id', asyncHandler(stockEntryController.getById));
router.post('/', upload.single('image'), asyncHandler(stockEntryController.create));
router.put('/:id', upload.single('image'), asyncHandler(stockEntryController.update));
router.post('/:id/pay', asyncHandler(stockEntryController.payEntry));

export default router;
