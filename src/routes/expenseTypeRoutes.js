import express from 'express';
import { list, create, remove, getLedger } from '../controllers/expenseTypeController.js';

const router = express.Router();

router.get('/', list);
router.post('/', create);
router.delete('/:id', remove);
router.get('/:id/ledger', getLedger);

export default router;
