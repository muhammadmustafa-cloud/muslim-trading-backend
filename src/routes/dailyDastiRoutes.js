import { Router } from 'express';
import { getDastiEntries, createDastiEntry, deleteDastiEntry } from '../controllers/dailyDastiController.js';

const router = Router();

router.get('/', getDastiEntries);
router.post('/', createDastiEntry);
router.delete('/:id', deleteDastiEntry);

export default router;
