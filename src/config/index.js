import dotenv from 'dotenv';

dotenv.config();

const env = process.env.NODE_ENV || 'development';
const isProd = env === 'production';

export const config = {
  env,
  isProd,
  port: parseInt(process.env.PORT || '5000', 10),
  mongo: {
    uri: process.env.MONGO_URI || 'mongodb://localhost:27017/mill',
    options: {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
    },
  },
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true,
  },
  log: {
    level: process.env.LOG_LEVEL || (isProd ? 'info' : 'debug'),
    dir: process.env.LOG_DIR || 'logs',
  },
};
