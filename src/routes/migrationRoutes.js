import express from 'express';
import { getMigrationEntities, updateEntityOpening } from '../controllers/migrationController.js';

const router = express.Router();

router.get('/entities', getMigrationEntities);
router.put('/update', updateEntityOpening);

export default router;
