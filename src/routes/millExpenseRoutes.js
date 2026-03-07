import { Router } from 'express';
import { asyncHandler } from '../middlewares/asyncHandler.js';
import * as millExpenseController from '../controllers/millExpenseController.js';

const router = Router();

router.get('/', asyncHandler(millExpenseController.list));
router.post('/', asyncHandler(millExpenseController.create));

export default router;
