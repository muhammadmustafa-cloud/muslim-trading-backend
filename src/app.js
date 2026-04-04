import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config/index.js';
import { errorHandler, notFound } from './middlewares/errorHandler.js';
import logger from './utils/logger.js';
import { tenantMiddleware } from './middleware/tenantMiddleware.js';
import routes from './routes/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Security
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(cors(config.cors));

// Body parsing
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Request logging (skip in test)
if (config.env !== 'test') {
  app.use(
    morgan('combined', {
      stream: { write: (msg) => logger.info(msg.trim()) },
      skip: (req, res) => res.statusCode < 400,
    })
  );
  app.use(morgan('dev'));
}

// Serve static uploaded files (images)
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// API routes with Multi-Tenant Support
app.use('/api', tenantMiddleware, routes);

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404
app.use(notFound);
// Global error handler
app.use(errorHandler);

export default app;
