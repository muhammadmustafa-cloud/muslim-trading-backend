import { Router } from 'express';
import { asyncHandler } from '../middlewares/asyncHandler.js';
import * as supplierController from '../controllers/supplierController.js';

const router = Router();

router.get('/', asyncHandler(supplierController.list));
router.get('/payables', asyncHandler(supplierController.getPayables));
router.get('/:id/history', asyncHandler(supplierController.getHistory));
router.get('/:id', asyncHandler(supplierController.getById));
router.post('/', asyncHandler(supplierController.create));
router.put('/:id', asyncHandler(supplierController.update));
router.delete('/:id', asyncHandler(supplierController.remove));

export default router;
