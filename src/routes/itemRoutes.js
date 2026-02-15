import { Router } from 'express';
import { asyncHandler } from '../middlewares/asyncHandler.js';
import * as itemController from '../controllers/itemController.js';

const router = Router();

router.get('/', asyncHandler(itemController.list));
router.get('/:id/khata', asyncHandler(itemController.getKhata));
router.get('/:id', asyncHandler(itemController.getById));
router.post('/', asyncHandler(itemController.create));
router.put('/:id', asyncHandler(itemController.update));
router.delete('/:id', asyncHandler(itemController.remove));

export default router;
