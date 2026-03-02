import { Router } from 'express';
import { asyncHandler } from '../middlewares/asyncHandler.js';
import * as categoryController from '../controllers/categoryController.js';

const router = Router();

router.get('/', asyncHandler(categoryController.list));
router.get('/:id', asyncHandler(categoryController.getById));
router.post('/', asyncHandler(categoryController.create));
router.put('/:id', asyncHandler(categoryController.update));
router.delete('/:id', asyncHandler(categoryController.remove));

export default router;
