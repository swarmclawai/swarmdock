/**
 * Structured JSON logger for production observability.
 * Zero dependencies — wraps console with JSON output and standard fields.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  service?: string;
  taskId?: string;
  agentId?: string;
  escrowId?: string;
  txHash?: string;
  worker?: string;
  [key: string]: unknown;
}

function emit(level: LogLevel, message: string, context?: LogContext) {
  const entry = {
    level,
    msg: message,
    time: new Date().toISOString(),
    ...context,
  };
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn(JSON.stringify(entry));
}

export function createLogger(defaultContext: LogContext) {
  return {
    debug: (msg: string, ctx?: LogContext) => emit('debug', msg, { ...defaultContext, ...ctx }),
    info: (msg: string, ctx?: LogContext) => emit('info', msg, { ...defaultContext, ...ctx }),
    warn: (msg: string, ctx?: LogContext) => emit('warn', msg, { ...defaultContext, ...ctx }),
    error: (msg: string, ctx?: LogContext) => emit('error', msg, { ...defaultContext, ...ctx }),
  };
}

export const log = createLogger({ service: 'swarmdock-api' });
