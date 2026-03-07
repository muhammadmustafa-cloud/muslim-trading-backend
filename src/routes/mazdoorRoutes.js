import { Router } from 'express';
import { asyncHandler } from '../middlewares/asyncHandler.js';
import * as mazdoorController from '../controllers/mazdoorController.js';

const router = Router();

router.get('/', asyncHandler(mazdoorController.list));
router.get('/:id/history', asyncHandler(mazdoorController.getHistory));
router.get('/:id', asyncHandler(mazdoorController.getById));
router.post('/', asyncHandler(mazdoorController.create));
router.put('/:id', asyncHandler(mazdoorController.update));

export default router;
