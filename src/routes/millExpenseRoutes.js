import { Router } from 'express';
import { asyncHandler } from '../middlewares/asyncHandler.js';
import upload from '../middleware/upload.js';
import * as millExpenseController from '../controllers/millExpenseController.js';

const router = Router();

router.get('/', asyncHandler(millExpenseController.list));
router.post('/', upload.single('image'), asyncHandler(millExpenseController.create));

export default router;
