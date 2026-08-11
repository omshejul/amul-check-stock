const client = require('prom-client');

const register = new client.Registry();
client.collectDefaultMetrics({ register, prefix: 'amul_stock_checker_' });

const httpRequests = new client.Counter({
  name: 'amul_stock_checker_http_requests_total',
  help: 'HTTP requests handled by the API',
  labelNames: ['method', 'route', 'status_class'],
  registers: [register]
});
const httpDuration = new client.Histogram({
  name: 'amul_stock_checker_http_request_duration_seconds',
  help: 'HTTP request duration',
  labelNames: ['method', 'route', 'status_class'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register]
});
const catalogRuns = new client.Counter({
  name: 'amul_stock_checker_catalog_runs_total',
  help: 'Catalog check runs',
  labelNames: ['status'],
  registers: [register]
});
const catalogDuration = new client.Histogram({
  name: 'amul_stock_checker_catalog_run_duration_seconds',
  help: 'Catalog check run duration',
  labelNames: ['status'],
  buckets: [0.5, 1, 2.5, 5, 10, 30, 60],
  registers: [register]
});
const catalogRequests = new client.Counter({
  name: 'amul_stock_checker_catalog_requests_total',
  help: 'Amul catalog requests',
  labelNames: ['status'],
  registers: [register]
});
const activeProducts = new client.Gauge({
  name: 'amul_stock_checker_active_products',
  help: 'Products with active subscriptions',
  registers: [register]
});
const lastSuccessfulRun = new client.Gauge({
  name: 'amul_stock_checker_last_successful_catalog_run_timestamp_seconds',
  help: 'Unix time of the last successful catalog run',
  registers: [register]
});
const errors = new client.Counter({
  name: 'amul_stock_checker_errors_total',
  help: 'Application errors by bounded operation',
  labelNames: ['operation'],
  registers: [register]
});

function normalizeRoute(req) {
  return req.route?.path ? `${req.baseUrl || ''}${req.route.path}` : 'unmatched';
}

function requestMetrics(req, res, next) {
  if (req.path === '/metrics' || req.path === '/health') return next();
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const labels = { method: req.method, route: normalizeRoute(req), status_class: `${Math.floor(res.statusCode / 100)}xx` };
    httpRequests.inc(labels);
    httpDuration.observe(labels, Number(process.hrtime.bigint() - started) / 1e9);
  });
  next();
}

module.exports = {
  register,
  requestMetrics,
  catalogRuns,
  catalogDuration,
  catalogRequests,
  activeProducts,
  lastSuccessfulRun,
  errors
};
