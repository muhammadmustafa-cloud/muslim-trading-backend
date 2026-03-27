import { Router } from 'express';
import { asyncHandler } from '../middlewares/asyncHandler.js';
import * as accountController from '../controllers/accountController.js';
import { protect, superAdminOnly } from '../middleware/authMiddleware.js';

const router = Router();

router.use(protect);

router.get('/daily-khata', asyncHandler(accountController.getDailyKhataAccount));
router.put('/daily-khata', superAdminOnly, asyncHandler(accountController.setDailyKhataAccount));
router.get('/mill-khata', asyncHandler(accountController.getOrCreateMillKhataAccount));
router.get('/', asyncHandler(accountController.list));
router.get('/:id', asyncHandler(accountController.getById));
router.post('/', asyncHandler(accountController.create));
router.put('/:id', superAdminOnly, asyncHandler(accountController.update));

export default router;
