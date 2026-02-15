import { Router } from 'express';
import { asyncHandler } from '../middlewares/asyncHandler.js';
import * as stockController from '../controllers/stockController.js';

const router = Router();

router.get('/current', asyncHandler(stockController.currentStock));

export default router;
