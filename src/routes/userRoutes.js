import { Router } from 'express';
import { asyncHandler } from '../middlewares/asyncHandler.js';
import * as userController from '../controllers/userController.js';
import { protect, superAdminOnly } from '../middleware/authMiddleware.js';

const router = Router();

router.use(protect);
router.use(superAdminOnly);

router.get('/', asyncHandler(userController.getUsers));
router.post('/', asyncHandler(userController.createUser));
router.put('/:id', asyncHandler(userController.updateUser));
router.delete('/:id', asyncHandler(userController.deleteUser));

export default router;
