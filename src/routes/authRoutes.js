import { Router } from 'express';
import { asyncHandler } from '../middlewares/asyncHandler.js';
import * as authController from '../controllers/authController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = Router();

router.post('/login', asyncHandler(authController.login));
router.get('/profile', protect, asyncHandler(authController.getProfile));

export default router;
