import { Router } from 'express';
import { asyncHandler } from '../middlewares/asyncHandler.js';
import * as customerController from '../controllers/customerController.js';

const router = Router();

router.get('/', asyncHandler(customerController.list));
router.get('/receivables', asyncHandler(customerController.getReceivables));
router.get('/:id/history', asyncHandler(customerController.getHistory));
router.get('/:id', asyncHandler(customerController.getById));
router.post('/', asyncHandler(customerController.create));
router.put('/:id', asyncHandler(customerController.update));
router.delete('/:id', asyncHandler(customerController.remove));

export default router;
