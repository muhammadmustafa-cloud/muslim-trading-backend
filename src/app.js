import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config/index.js';
import { errorHandler, notFound } from './middlewares/errorHandler.js';
import logger from './utils/logger.js';
import routes from './routes/index.js';

const app = express();

// Security
app.use(helmet());
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

// API routes
app.use('/api', routes);

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404
app.use(notFound);
// Global error handler
app.use(errorHandler);

export default app;
