import winston from 'winston';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { config } from '../config/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logDir = path.resolve(process.cwd(), config.log.dir);

// Only try to create log directory if not in production
if (!config.isProd && !fs.existsSync(logDir)) {
  try {
    fs.mkdirSync(logDir, { recursive: true });
  } catch (error) {
    console.warn('Could not create log directory:', error.message);
  }
}

const { combine, timestamp, printf, colorize, errors } = winston.format;

const logFormat = printf(({ level, message, timestamp: ts, stack, ...meta }) => {
  const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  return `${ts} [${level}]: ${stack || message}${metaStr}`;
});

const logger = winston.createLogger({
  level: config.log.level,
  format: combine(
    errors({ stack: true }),
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    logFormat
  ),
  defaultMeta: { service: 'mill-backend' },
  transports: [
    // Only add file transports if not in production
    ...(config.isProd ? [] : [
      new winston.transports.File({ filename: path.join(logDir, 'error.log'), level: 'error' }),
      new winston.transports.File({ filename: path.join(logDir, 'combined.log') })
    ]),
    // Always add console transport for deployment visibility
    new winston.transports.Console({
      format: config.isProd 
        ? combine(timestamp(), logFormat)
        : combine(colorize(), timestamp({ format: 'HH:mm:ss' }), logFormat)
    })
  ],
});

export default logger;
