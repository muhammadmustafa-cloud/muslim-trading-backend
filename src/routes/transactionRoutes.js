import { Router } from 'express';
import { asyncHandler } from '../middlewares/asyncHandler.js';
import * as transactionController from '../controllers/transactionController.js';

const router = Router();

router.get('/', asyncHandler(transactionController.list));
router.get('/:id', asyncHandler(transactionController.getById));
router.post('/', asyncHandler(transactionController.create));
router.delete('/:id', asyncHandler(transactionController.remove));

export default router;
