import logger from '../utils/logger.js';

export const uploadDocument = async (req, res, next) => {
  try {
    const { ScannedDocument } = req.models;
    const { documentType, imageUrl, recordDate, notes } = req.body;

    if (!documentType || !imageUrl || !recordDate) {
      return res.status(400).json({
        success: false,
        message: 'documentType, imageUrl, and recordDate are required.',
      });
    }

    const newDoc = new ScannedDocument({
      tenantId: req.user._id,
      documentType,
      imageUrl, // base64 string
      recordDate: new Date(recordDate),
      notes: notes || '',
    });

    await newDoc.save();

    res.status(201).json({
      success: true,
      message: 'Document uploaded successfully',
      data: newDoc,
    });
  } catch (error) {
    logger.error(`Upload Document error: ${error.message}`);
    next(error);
  }
};

export const getDocuments = async (req, res, next) => {
  try {
    const { ScannedDocument } = req.models;
    const { documentType, startDate, endDate, page = 1, limit = 20 } = req.query;

    const query = { tenantId: req.user._id };

    if (documentType) {
      query.documentType = documentType;
    }

    if (startDate || endDate) {
      query.recordDate = {};
      if (startDate) query.recordDate.$gte = new Date(startDate);
      if (endDate) query.recordDate.$lte = new Date(endDate);
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const documents = await ScannedDocument.find(query)
      .sort({ recordDate: -1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await ScannedDocument.countDocuments(query);

    res.status(200).json({
      success: true,
      data: documents,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    logger.error(`Get Documents error: ${error.message}`);
    next(error);
  }
};

export const deleteDocument = async (req, res, next) => {
  try {
    const { ScannedDocument } = req.models;
    const { id } = req.params;

    const document = await ScannedDocument.findOneAndDelete({ _id: id, tenantId: req.user._id });

    if (!document) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    res.status(200).json({
      success: true,
      message: 'Document deleted successfully',
    });
  } catch (error) {
    logger.error(`Delete Document error: ${error.message}`);
    next(error);
  }
};
