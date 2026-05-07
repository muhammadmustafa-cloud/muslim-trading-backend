import { Router } from 'express';
import { asyncHandler } from '../middlewares/asyncHandler.js';
import * as partyLedgerController from '../controllers/partyLedgerController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = Router();

router.use(protect);

router.get('/:id', asyncHandler(partyLedgerController.getPartyLedger));

export default router;
