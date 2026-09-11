import winston from 'winston';
import { env } from './env.js';

const runtime = process.env.NODE_ENV ?? 'local';

export const logger = winston.createLogger({
  level: env.logLevel,
  defaultMeta: { service: 'project-tasks-mcp', runtime },
  format: winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp({ format: () => new Date().toISOString() }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ timestamp, level, message, status, durationMs, service: _service, runtime: source, ...meta }) => {
      const details = Object.keys(meta).length ? ' - ' + JSON.stringify(meta) : '';
      const statusPart = status === undefined ? '' : ' - ' + status;
      const durationPart = durationMs === undefined ? '' : ' - ' + durationMs + ' ms';
      return level + ': ' + timestamp + ' [' + source + '] ' + message + statusPart + durationPart + details;
    })
  ),
  transports: [new winston.transports.Console()]
});
