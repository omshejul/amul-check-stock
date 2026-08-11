const { context, trace, SpanStatusCode } = require('@opentelemetry/api');
const { logs, SeverityNumber } = require('@opentelemetry/api-logs');

const otelLogger = logs.getLogger('amul-stock-checker-api');
const REDACTIONS = [
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]'],
  [/(authorization|cookie|token|apikey|password)(["'\s:=]+)[^\s,;"'}]+/gi, '$1$2[REDACTED]'],
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL]'],
  [/(?:\+?91[-\s]?)?[6-9]\d{9}/g, '[PHONE]'],
  [/https?:\/\/[^\s]+/gi, '[URL]']
];

function sanitizeText(value, maxLength = 2000) {
  let text = String(value || 'Unknown error');
  for (const [pattern, replacement] of REDACTIONS) text = text.replace(pattern, replacement);
  return text.slice(0, maxLength);
}

function safeError(error) {
  return {
    type: sanitizeText(error?.name || 'Error', 120),
    message: sanitizeText(error?.message || error, 500),
    stack: sanitizeText(error?.stack || '', 4000)
  };
}

function log(level, message, fields = {}) {
  const spanContext = trace.getSpan(context.active())?.spanContext();
  const record = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...fields,
    ...(spanContext?.traceId ? { trace_id: spanContext.traceId, span_id: spanContext.spanId } : {})
  };
  process.stdout.write(`${JSON.stringify(record)}\n`);
  const severityNumber = {
    debug: SeverityNumber.DEBUG,
    info: SeverityNumber.INFO,
    warn: SeverityNumber.WARN,
    error: SeverityNumber.ERROR,
    fatal: SeverityNumber.FATAL
  }[level] || SeverityNumber.INFO;
  otelLogger.emit({ severityNumber, severityText: level.toUpperCase(), body: message, attributes: record });
}

function recordError(error, operation, fields = {}) {
  const safe = safeError(error);
  const span = trace.getSpan(context.active());
  if (span) {
    span.recordException(safe);
    span.setStatus({ code: SpanStatusCode.ERROR, message: safe.message });
  }
  log('error', 'operation_failed', { operation, error_type: safe.type, error_message: safe.message, error_stack: safe.stack, ...fields });
}

module.exports = { log, recordError, safeError, sanitizeText };
