import { Router } from 'express';
import { getDailyMemo } from '../controllers/dailyMemoController.js';

const router = Router();
router.get('/', getDailyMemo);

export default router;
