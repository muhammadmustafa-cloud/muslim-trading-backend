import express from 'express';
import * as scannedDocumentController from '../controllers/scannedDocumentController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(protect); // Ensure user is authenticated

router.post('/', scannedDocumentController.uploadDocument);
router.get('/', scannedDocumentController.getDocuments);
router.delete('/:id', scannedDocumentController.deleteDocument);

export default router;
