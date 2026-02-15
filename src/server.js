import app from './app.js';
import { config } from './config/index.js';
import connectDB from './config/database.js';
import logger from './utils/logger.js';

const startServer = async () => {
  await connectDB();

  const server = app.listen(config.port, () => {
    logger.info(`Server running in ${config.env} on port ${config.port}`);
  });

  const shutdown = (signal) => {
    logger.info(`${signal} received. Shutting down gracefully.`);
    server.close(() => {
      logger.info('HTTP server closed.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
};

startServer().catch((err) => {
  logger.error('Failed to start server:', err);
  process.exit(1);
});
