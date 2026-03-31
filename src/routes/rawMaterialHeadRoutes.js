import express from 'express';
import { list, create, update, remove } from '../controllers/rawMaterialHeadController.js';

const router = express.Router();

router.get('/', list);
router.post('/', create);
router.put('/:id', update);
router.delete('/:id', remove);

export default router;
