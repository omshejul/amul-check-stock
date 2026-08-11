const { NodeSDK } = require('@opentelemetry/sdk-node');
const { resourceFromAttributes } = require('@opentelemetry/resources');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-proto');
const { OTLPLogExporter } = require('@opentelemetry/exporter-logs-otlp-proto');
const { BatchLogRecordProcessor } = require('@opentelemetry/sdk-logs');
const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');
const { ExpressInstrumentation } = require('@opentelemetry/instrumentation-express');

const serviceName = process.env.OTEL_SERVICE_NAME || 'amul-stock-checker-api';
const environment = process.env.DEPLOYMENT_ENVIRONMENT || 'production';
const resource = resourceFromAttributes({
  'service.name': serviceName,
  project: 'amul-stock-checker',
  'deployment.environment.name': environment,
  'service.version': process.env.SERVICE_VERSION || 'local'
});

const traceEndpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
const logEndpoint = process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT;
const logToken = process.env.GRAFANA_OTLP_LOGS_TOKEN;

const sdk = new NodeSDK({
  resource,
  traceExporter: traceEndpoint ? new OTLPTraceExporter({ url: traceEndpoint }) : undefined,
  logRecordProcessors: logEndpoint && logToken
    ? [new BatchLogRecordProcessor({ exporter: new OTLPLogExporter({
        url: logEndpoint,
        headers: { Authorization: `Bearer ${logToken}` }
      }) })]
    : [],
  instrumentations: [
    new HttpInstrumentation({
      ignoreIncomingRequestHook: (request) => ['/health', '/metrics'].includes((request.url || '').split('?')[0])
    }),
    new ExpressInstrumentation()
  ]
});

sdk.start();

async function shutdownTelemetry() {
  await sdk.shutdown();
}

module.exports = { shutdownTelemetry };
