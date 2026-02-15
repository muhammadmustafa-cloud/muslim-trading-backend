import { Router } from 'express';
import { asyncHandler } from '../middlewares/asyncHandler.js';
import * as dashboardController from '../controllers/dashboardController.js';

const router = Router();

router.get('/', asyncHandler(dashboardController.getSummary));

export default router;
