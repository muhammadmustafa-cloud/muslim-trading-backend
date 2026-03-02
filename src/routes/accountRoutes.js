import { Router } from 'express';
import { asyncHandler } from '../middlewares/asyncHandler.js';
import * as accountController from '../controllers/accountController.js';

const router = Router();

router.get('/daily-khata', asyncHandler(accountController.getDailyKhataAccount));
router.put('/daily-khata', asyncHandler(accountController.setDailyKhataAccount));
router.get('/mill-khata', asyncHandler(accountController.getOrCreateMillKhataAccount));
router.get('/', asyncHandler(accountController.list));
router.get('/:id', asyncHandler(accountController.getById));
router.post('/', asyncHandler(accountController.create));
router.put('/:id', asyncHandler(accountController.update));
router.delete('/:id', asyncHandler(accountController.remove));

export default router;
