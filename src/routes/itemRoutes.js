import { Router } from 'express';
import { asyncHandler } from '../middlewares/asyncHandler.js';
import * as itemController from '../controllers/itemController.js';
import { protect, superAdminOnly } from '../middleware/authMiddleware.js';

const router = Router();

router.get('/', protect, asyncHandler(itemController.list));
router.get('/:id/khata', protect, asyncHandler(itemController.getKhata));
router.get('/:id/sub-khata', protect, asyncHandler(itemController.getSubItemKhata));
router.get('/:id/sub-items-summary', protect, asyncHandler(itemController.getSubItemsSalesSummary));
router.get('/:id', protect, asyncHandler(itemController.getById));
router.post('/', protect, superAdminOnly, asyncHandler(itemController.create));
router.put('/:id', protect, superAdminOnly, asyncHandler(itemController.update));

export default router;
