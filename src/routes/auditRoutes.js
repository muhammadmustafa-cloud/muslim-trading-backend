import express from 'express';
import { getAuditSummary } from '../controllers/auditController.js';

const router = express.Router();

router.get('/summary', getAuditSummary);

export default router;
