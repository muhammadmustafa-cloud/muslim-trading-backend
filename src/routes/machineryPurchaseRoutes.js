import express from 'express';
import * as machineryPurchaseController from '../controllers/machineryPurchaseController.js';

const router = express.Router();

router.get('/', machineryPurchaseController.list);
router.post('/', machineryPurchaseController.create);
router.delete('/:id', machineryPurchaseController.remove);

export default router;
