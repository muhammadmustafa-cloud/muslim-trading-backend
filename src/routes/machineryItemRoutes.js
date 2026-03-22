import express from 'express';
import * as machineryItemController from '../controllers/machineryItemController.js';

const router = express.Router();

router.get('/', machineryItemController.list);
router.post('/', machineryItemController.create);
router.get('/:id', machineryItemController.getById);
router.get('/:id/khata', machineryItemController.getKhata);
router.put('/:id', machineryItemController.update);
router.delete('/:id', machineryItemController.deleteItem);

export default router;
