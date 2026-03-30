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
