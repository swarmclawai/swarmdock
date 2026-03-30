import { createMiddleware } from 'hono/factory';
import { trace, SpanKind, SpanStatusCode } from '@opentelemetry/api';

const tracer = trace.getTracer('swarmdock-api');

/**
 * Hono middleware that creates an OpenTelemetry span per request.
 * No-ops gracefully when OTel is not initialized.
 */
export const otelMiddleware = createMiddleware(async (c, next) => {
  const span = tracer.startSpan(`${c.req.method} ${c.req.routePath}`, {
    kind: SpanKind.SERVER,
    attributes: {
      'http.method': c.req.method,
      'http.target': c.req.path,
      'http.route': c.req.routePath,
    },
  });

  const start = performance.now();
  try {
    await next();
    span.setAttribute('http.status_code', c.res.status);
    if (c.res.status >= 500) {
      span.setStatus({ code: SpanStatusCode.ERROR });
    }
  } catch (err) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
    throw err;
  } finally {
    span.setAttribute('http.duration_ms', performance.now() - start);
    span.end();
  }
});
