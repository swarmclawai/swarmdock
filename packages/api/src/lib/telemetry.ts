/**
 * OpenTelemetry instrumentation for SwarmDock API.
 *
 * Must be imported BEFORE any other modules to ensure proper monkey-patching.
 * Activated when OTEL_EXPORTER_OTLP_ENDPOINT is set.
 *
 * Required packages (install separately for production):
 *   @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node
 *   @opentelemetry/exporter-trace-otlp-http @opentelemetry/exporter-metrics-otlp-http
 *   @opentelemetry/sdk-metrics @opentelemetry/resources @opentelemetry/semantic-conventions
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dynamicImport = (mod: string): Promise<any> =>
  Function('m', 'return import(m)')(mod) as Promise<unknown>;

export async function initTelemetry(): Promise<void> {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) return;

  try {
    const [sdkNode, autoInst, traceExp, metricExp, sdkMetrics, resources, semconv] = await Promise.all([
      dynamicImport('@opentelemetry/sdk-node'),
      dynamicImport('@opentelemetry/auto-instrumentations-node'),
      dynamicImport('@opentelemetry/exporter-trace-otlp-http'),
      dynamicImport('@opentelemetry/exporter-metrics-otlp-http'),
      dynamicImport('@opentelemetry/sdk-metrics'),
      dynamicImport('@opentelemetry/resources'),
      dynamicImport('@opentelemetry/semantic-conventions'),
    ]).catch(() => [null, null, null, null, null, null, null]);

    if (!sdkNode || !autoInst || !traceExp || !metricExp || !sdkMetrics || !resources || !semconv) {
      console.warn('[OTEL] OTEL_EXPORTER_OTLP_ENDPOINT set but OpenTelemetry packages not installed — skipping');
      return;
    }

    const resource = new resources.Resource({
      [semconv.ATTR_SERVICE_NAME]: 'swarmdock-api',
      [semconv.ATTR_SERVICE_VERSION]: '0.2.0',
    });

    const sdk = new sdkNode.NodeSDK({
      resource,
      traceExporter: new traceExp.OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
      metricReader: new sdkMetrics.PeriodicExportingMetricReader({
        exporter: new metricExp.OTLPMetricExporter({ url: `${endpoint}/v1/metrics` }),
        exportIntervalMillis: 30_000,
      }),
      instrumentations: [
        autoInst.getNodeAutoInstrumentations({
          '@opentelemetry/instrumentation-http': { enabled: true },
          '@opentelemetry/instrumentation-pg': { enabled: true },
        }),
      ],
    });

    sdk.start();
    console.log(`[OTEL] initialized, exporting to ${endpoint}`);

    process.on('SIGTERM', () => {
      sdk.shutdown().catch(console.error);
    });
  } catch (err) {
    console.error('[OTEL] failed to initialize:', err);
  }
}
