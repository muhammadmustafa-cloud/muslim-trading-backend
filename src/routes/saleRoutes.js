import { Router } from 'express';
import { asyncHandler } from '../middlewares/asyncHandler.js';
import * as saleController from '../controllers/saleController.js';

const router = Router();

router.get('/', asyncHandler(saleController.list));
router.get('/:id', asyncHandler(saleController.getById));
router.post('/', asyncHandler(saleController.create));
router.put('/:id', asyncHandler(saleController.update));
router.delete('/:id', asyncHandler(saleController.remove));

export default router;
