/**
 * OpenTelemetry instrumentation for SwarmDock API.
 *
 * Must be imported BEFORE any other modules to ensure proper monkey-patching.
 * Activated when OTEL_EXPORTER_OTLP_ENDPOINT is set.
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { trace, SpanStatusCode, type Attributes } from '@opentelemetry/api';

const businessTracer = trace.getTracer('swarmdock-api.business');

/**
 * Wrap a business operation in an OpenTelemetry span.
 * No-ops gracefully when OTel is not initialized (returns the function result).
 * Records exceptions and sets ERROR status on throw.
 */
export async function traceOp<T>(
  name: string,
  attributes: Attributes,
  fn: () => Promise<T>,
): Promise<T> {
  const span = businessTracer.startSpan(name, { attributes });
  try {
    const result = await fn();
    return result;
  } catch (err) {
    span.recordException(err as Error);
    span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
    throw err;
  } finally {
    span.end();
  }
}

let sdk: NodeSDK | null = null;

export async function initTelemetry(): Promise<void> {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) return;

  try {
    const resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: 'swarmdock-api',
      [ATTR_SERVICE_VERSION]: '0.2.2',
    });

    sdk = new NodeSDK({
      resource,
      traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
      metricReader: new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` }),
        exportIntervalMillis: 30_000,
      }),
      instrumentations: [
        getNodeAutoInstrumentations({
          '@opentelemetry/instrumentation-http': { enabled: true },
          '@opentelemetry/instrumentation-pg': { enabled: true },
        }),
      ],
    });

    sdk.start();
    console.log(`[OTEL] initialized, exporting to ${endpoint}`);

    process.on('SIGTERM', () => {
      sdk?.shutdown().catch(console.error);
    });
  } catch (err) {
    console.error('[OTEL] failed to initialize:', err);
  }
}
