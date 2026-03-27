import { SpanStatusCode, trace } from '@opentelemetry/api';
import { NextResponse } from 'next/server';

type RouteLogExtras = Record<string, unknown>;

type RouteLogContext = {
  requestId: string;
  route: string;
  method: string;
  path: string;
  startMs: number;
  span: ReturnType<ReturnType<typeof trace.getTracer>['startSpan']>;
};

const LOG_LEVEL_PRIORITY = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
} as const;

type LogLevel = keyof typeof LOG_LEVEL_PRIORITY;

function currentLogLevel(): LogLevel {
  const value = process.env.APP_LOG_LEVEL;
  return value === 'debug' || value === 'info' || value === 'warn' || value === 'error'
    ? value
    : 'info';
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[currentLogLevel()];
}

function safeLogValue(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => safeLogValue(item));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, safeLogValue(nestedValue)]),
    );
  }

  return value;
}

function logEvent(level: LogLevel, event: string, payload: RouteLogExtras): void {
  if (!shouldLog(level)) {
    return;
  }

  const logger = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  const safePayload = safeLogValue(payload);
  logger(
    JSON.stringify({
      level,
      event,
      ts: new Date().toISOString(),
      ...(typeof safePayload === 'object' && safePayload !== null ? safePayload : {}),
    }),
  );
}

export function beginRouteRequest(
  route: string,
  request: Request,
  extras: RouteLogExtras = {},
): RouteLogContext {
  const tracer = trace.getTracer('tbsb-dashboard.routes');
  const requestId = crypto.randomUUID();
  const url = new URL(request.url);
  const span = tracer.startSpan(route, {
    attributes: {
      'http.method': request.method,
      'http.route': route,
      'http.target': url.pathname,
      'app.request_id': requestId,
    },
  });

  const context: RouteLogContext = {
    requestId,
    route,
    method: request.method,
    path: url.pathname,
    startMs: Date.now(),
    span,
  };

  logEvent('info', 'route_start', {
    requestId,
    route,
    method: request.method,
    path: url.pathname,
    ...extras,
  });

  return context;
}

type JsonResponseInit = ResponseInit & {
  status?: number;
};

export function routeJson<T>(
  context: RouteLogContext,
  body: T,
  init: JsonResponseInit = {},
  extras: RouteLogExtras = {},
): NextResponse<T> {
  const response = NextResponse.json(body, init);
  response.headers.set('x-request-id', context.requestId);

  const status = init.status ?? 200;
  const durationMs = Date.now() - context.startMs;

  context.span.setAttribute('http.status_code', status);
  context.span.setAttribute('app.duration_ms', durationMs);
  context.span.setStatus({
    code: status >= 500 ? SpanStatusCode.ERROR : SpanStatusCode.OK,
  });
  context.span.end();

  logEvent(status >= 500 ? 'error' : 'info', 'route_end', {
    requestId: context.requestId,
    route: context.route,
    method: context.method,
    path: context.path,
    status,
    durationMs,
    ...extras,
  });

  return response;
}

export function routeErrorJson(
  context: RouteLogContext,
  message: string,
  status: number,
  extras: RouteLogExtras = {},
): NextResponse<{ error: string }> {
  return routeJson(context, { error: message }, { status }, { error: message, ...extras });
}
