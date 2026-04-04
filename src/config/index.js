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
  allowedClients: (process.env.ALLOWED_CLIENTS || '').split(',').map(c => c.trim()).filter(Boolean),
  cors: {
    origin: process.env.CORS_ORIGIN 
      ? process.env.CORS_ORIGIN.split(',').map(origin => origin.trim())
      : (isProd ? ['https://muslim-trading.vercel.app', 'https://muslim-trading-backend.onrender.com'] : ['http://localhost:5173', 'http://127.0.0.1:5173']),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-client-id'],
  },
  log: {
    level: process.env.LOG_LEVEL || (isProd ? 'info' : 'debug'),
    dir: process.env.LOG_DIR || 'logs',
  },
};
