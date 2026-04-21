import pino from 'pino';

// JSON logs by default. Railway aggregates whatever is on stdout, so this
// just works out of the box. Set LOG_LEVEL=debug locally for more detail.
export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: { service: 'resource-room-agent' },
  formatters: {
    level(label) { return { level: label }; },
  },
});

export default logger;
