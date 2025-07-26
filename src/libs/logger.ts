import { createLogger, format, transports } from 'winston';
import path from 'path';

const { combine, timestamp, printf, colorize, errors } = format;

// Log format with timestamp
const logFormat = printf(({ level, message, timestamp, stack }) => {
  return `${timestamp} [${level}]: ${stack || message}`;
});

// Winston logger instance
const logger = createLogger({
  level: 'info',
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true }), // capture error stack trace
    logFormat
  ),
  transports: [
    // Console with colors
    new transports.Console({
      format: combine(colorize(), logFormat),
    }),

    // Write all logs to combined.log
    new transports.File({
      filename: path.join(__dirname, '../../logs/combined.log'),
    }),

    // Write only errors to error.log
    new transports.File({
      filename: path.join(__dirname, '../../logs/error.log'),
      level: 'error',
    }),
  ],
  exitOnError: false,
});

export default logger;
