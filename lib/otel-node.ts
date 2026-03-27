import { DiagConsoleLogger, DiagLogLevel, diag } from '@opentelemetry/api';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getAppEnv } from './env';

let sdk: NodeSDK | null = null;
let started = false;

export async function registerOpenTelemetry(): Promise<void> {
  if (started) {
    return;
  }

  started = true;

  const env = getAppEnv();
  if (!env.OTEL_ENABLED) {
    return;
  }

  if (env.OTEL_DIAG_LOGGING) {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);
  }

  sdk = new NodeSDK({
    serviceName: env.OTEL_SERVICE_NAME,
    instrumentations: [getNodeAutoInstrumentations()],
    ...(env.OTEL_EXPORTER_OTLP_ENDPOINT
      ? {
          traceExporter: new OTLPTraceExporter({
            url: env.OTEL_EXPORTER_OTLP_ENDPOINT,
          }),
        }
      : {}),
  });

  sdk.start();

  await Promise.resolve();
}

export async function shutdownOpenTelemetry(): Promise<void> {
  if (!sdk) {
    return;
  }

  await sdk.shutdown();
  sdk = null;
  started = false;
}
