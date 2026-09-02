import pino from 'pino';

export type Logger = pino.Logger;

export function createLogger(level: string, pretty: boolean): Logger {
  return pino({
    level,
    ...(pretty
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:standard' },
          },
        }
      : {}),
    redact: {
      paths: [
        'token',
        'password',
        '*.token',
        '*.password',
        '*.apiKey',
        '*.secret',
        'req.headers.authorization',
      ],
      censor: '[REDACTED]',
    },
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

/** Never log secrets: mask token-like values in free-form messages. */
export function maskSecrets(value: string): string {
  return value
    .replace(/\b(bot)?\s*token\s*[:=]\s*\S+/gi, 'token=[REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{10,}\b/g, '[REDACTED]');
}
