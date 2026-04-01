import { getHotDataPlaneEnv, hasHotDataPlaneEnv, type HotDataPlaneEnv } from './env';
import { readJsonResponse } from './httpCache';
import { hashJsonValue } from './json-stable';
import { recordParityAudit } from './route-audit-server';

export type HotDataPlaneRouteKey =
  | 'bootstrap'
  | 'active-target'
  | 'team-events'
  | 'refresh-active-target'
  | 'compare-bundle'
  | 'predict-bundle'
  | 'alliance-bundle'
  | 'playoff-bundle'
  | 'impact-bundle'
  | 'pick-list-bundle';

type RouteContext = {
  workspaceKey?: string | null | undefined;
  eventKey?: string | null | undefined;
  teamNumber?: number | null | undefined;
  scenarioId?: string | null | undefined;
};

function routeIsEnabled(env: HotDataPlaneEnv, routeKey: HotDataPlaneRouteKey): boolean {
  return (
    !env.HOT_DATA_PLANE_PROXY_ROUTES.length || env.HOT_DATA_PLANE_PROXY_ROUTES.includes(routeKey)
  );
}

function buildForwardHeaders(
  headers: HeadersInit | undefined,
  env: HotDataPlaneEnv,
  routeKey: HotDataPlaneRouteKey,
): Headers {
  const nextHeaders = new Headers(headers ?? {});
  nextHeaders.delete('host');
  nextHeaders.delete('content-length');
  nextHeaders.set('x-tbsb-hot-route', routeKey);
  if (env.HOT_DATA_PLANE_BEARER_TOKEN) {
    nextHeaders.set('Authorization', `Bearer ${env.HOT_DATA_PLANE_BEARER_TOKEN}`);
  }
  return nextHeaders;
}

function buildForwardUrl(baseUrl: string, path: string, requestUrl: string): string {
  const nextUrl = new URL(path.replace(/^\/+/, '/'), `${baseUrl.replace(/\/+$/, '')}/`);
  const incomingUrl = new URL(requestUrl);
  nextUrl.search = incomingUrl.search;
  return nextUrl.toString();
}

async function forwardToHotDataPlane(
  req: Request,
  routeKey: HotDataPlaneRouteKey,
  path: string,
): Promise<Response | null> {
  if (!hasHotDataPlaneEnv()) return null;

  const env = getHotDataPlaneEnv();
  if (!routeIsEnabled(env, routeKey)) return null;

  const url = buildForwardUrl(env.HOT_DATA_PLANE_URL, path, req.url);
  const method = req.method.toUpperCase();
  const body =
    method === 'GET' || method === 'HEAD'
      ? undefined
      : await req
          .clone()
          .text()
          .catch(() => '');

  return fetch(url, {
    method,
    headers: buildForwardHeaders(req.headers, env, routeKey),
    ...(body ? { body } : {}),
    cache: 'no-store',
  }).catch(() => null);
}

function topLevelSummary(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) {
    return {
      type: 'array',
      length: value.length,
    };
  }

  if (value && typeof value === 'object') {
    return {
      type: 'object',
      keys: Object.keys(value as Record<string, unknown>).sort(),
    };
  }

  return {
    type: value == null ? 'null' : typeof value,
  };
}

export async function maybeProxyToHotDataPlane(
  req: Request,
  routeKey: HotDataPlaneRouteKey,
  path: string,
): Promise<Response | null> {
  if (!hasHotDataPlaneEnv()) return null;

  const env = getHotDataPlaneEnv();
  if (env.HOT_DATA_PLANE_MODE !== 'proxy' || !routeIsEnabled(env, routeKey)) {
    return null;
  }

  const response = await forwardToHotDataPlane(req, routeKey, path);
  if (!response) return null;
  if (response.ok || response.status < 500) return response;
  return null;
}

export function queueHotDataPlaneParityCheck(
  req: Request,
  routeKey: HotDataPlaneRouteKey,
  path: string,
  localPayload: unknown,
  context: RouteContext = {},
): void {
  if (!hasHotDataPlaneEnv()) return;

  const env = getHotDataPlaneEnv();
  if (env.HOT_DATA_PLANE_MODE !== 'shadow' || !routeIsEnabled(env, routeKey)) {
    return;
  }

  void (async () => {
    const response = await forwardToHotDataPlane(req, routeKey, path);
    if (!response) {
      await recordParityAudit({
        routeKey,
        workspaceKey: context.workspaceKey,
        eventKey: context.eventKey,
        teamNumber: context.teamNumber,
        scenarioId: context.scenarioId,
        status: 'error',
        detail: {
          message: 'Hot data plane request failed before returning a response.',
        },
      });
      return;
    }

    const remotePayload = await readJsonResponse<Record<string, unknown> | { error: string }>(
      response,
    );
    if (!response.ok) {
      await recordParityAudit({
        routeKey,
        workspaceKey: context.workspaceKey,
        eventKey: context.eventKey,
        teamNumber: context.teamNumber,
        scenarioId: context.scenarioId,
        status: 'error',
        detail: {
          httpStatus: response.status,
          remoteSummary: topLevelSummary(remotePayload),
          remoteError:
            remotePayload &&
            typeof remotePayload === 'object' &&
            'error' in remotePayload &&
            typeof remotePayload.error === 'string'
              ? remotePayload.error
              : null,
        },
      });
      return;
    }

    const localHash = hashJsonValue(localPayload);
    const remoteHash = hashJsonValue(remotePayload);
    const status = localHash === remoteHash ? 'match' : 'diff';

    await recordParityAudit({
      routeKey,
      workspaceKey: context.workspaceKey,
      eventKey: context.eventKey,
      teamNumber: context.teamNumber,
      scenarioId: context.scenarioId,
      status,
      detail: {
        localHash,
        remoteHash,
        httpStatus: response.status,
        localSummary: topLevelSummary(localPayload),
        remoteSummary: topLevelSummary(remotePayload),
      },
    });
  })();
}
