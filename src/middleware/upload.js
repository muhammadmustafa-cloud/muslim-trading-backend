import multer from 'multer';
import path from 'path';

// Define storage location and file naming strategy
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Files are uploaded directly to the "uploads" folder in the backend root
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    // Create unique filename using timestamp
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + ext);
  }
});

// Define file filter for images only
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only JPEG, PNG, JPG, and WEBP image formats are allowed!'), false);
  }
};

// Create the unified upload middleware
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB strict limit
  }
});

export default upload;
