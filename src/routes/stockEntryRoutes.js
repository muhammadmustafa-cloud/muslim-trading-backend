import { Router } from 'express';
import { asyncHandler } from '../middlewares/asyncHandler.js';
import * as stockEntryController from '../controllers/stockEntryController.js';

const router = Router();

router.get('/', asyncHandler(stockEntryController.list));
router.get('/pending', asyncHandler(stockEntryController.listPending));
router.get('/:id', asyncHandler(stockEntryController.getById));
router.post('/', asyncHandler(stockEntryController.create));
router.put('/:id', asyncHandler(stockEntryController.update));
router.post('/:id/pay', asyncHandler(stockEntryController.payEntry));
router.delete('/:id', asyncHandler(stockEntryController.remove));

export default router;
