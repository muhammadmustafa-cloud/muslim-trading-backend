import { Router } from 'express';
import { asyncHandler } from '../middlewares/asyncHandler.js';
import * as mazdoorItemController from '../controllers/mazdoorItemController.js';

const router = Router();

router.get('/', asyncHandler(mazdoorItemController.list));
router.get('/:id', asyncHandler(mazdoorItemController.getById));
router.post('/', asyncHandler(mazdoorItemController.create));
router.put('/:id', asyncHandler(mazdoorItemController.update));
router.delete('/:id', asyncHandler(mazdoorItemController.remove));

export default router;
