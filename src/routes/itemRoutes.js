import { Router } from 'express';
import { asyncHandler } from '../middlewares/asyncHandler.js';
import * as itemController from '../controllers/itemController.js';
import { protect, superAdminOnly } from '../middleware/authMiddleware.js';

const router = Router();

router.use(protect);

router.get('/', asyncHandler(itemController.list));
router.get('/:id/khata', asyncHandler(itemController.getKhata));
router.get('/:id', asyncHandler(itemController.getById));
router.post('/', asyncHandler(itemController.create));
router.put('/:id', superAdminOnly, asyncHandler(itemController.update));

export default router;
