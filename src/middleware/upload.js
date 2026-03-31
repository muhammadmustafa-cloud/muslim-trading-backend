import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'dbs72ujyh',
  api_key: process.env.CLOUDINARY_API_KEY || '411876669888183',
  api_secret: process.env.CLOUDINARY_API_SECRET || 'PH2BanztFRuJZa0V9LBht9mnoQw',
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'mill_receipts',
    allowed_formats: ['jpeg', 'png', 'jpg', 'webp'],
  },
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024,
  }
});

export default upload;
