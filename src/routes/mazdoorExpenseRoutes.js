import { Router } from 'express';
import { asyncHandler } from '../middlewares/asyncHandler.js';
import * as mazdoorExpenseController from '../controllers/mazdoorExpenseController.js';

const router = Router();

router.get('/', asyncHandler(mazdoorExpenseController.list));
router.post('/', asyncHandler(mazdoorExpenseController.create));

export default router;
