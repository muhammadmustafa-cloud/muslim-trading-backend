import { Router } from 'express';
import { asyncHandler } from '../middlewares/asyncHandler.js';
import * as stockController from '../controllers/stockController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = Router();

router.use(protect);

router.get('/', asyncHandler(stockController.currentStock));
router.get('/current', asyncHandler(stockController.currentStock));

export default router;
