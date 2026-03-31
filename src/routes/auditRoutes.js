import express from 'express';
import { getAuditSummary, getConsolidatedLedgers } from '../controllers/auditController.js';

const router = express.Router();

router.get('/summary', getAuditSummary);
router.get('/consolidated-ledgers', getConsolidatedLedgers);

export default router;
