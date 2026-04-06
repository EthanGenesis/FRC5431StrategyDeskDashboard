export const CACHE_REFRESH_SURFACES = [
  'bootstrap',
  'snapshot',
  'event-context',
  'team-profile',
  'data-super',
  'district-points',
  'game-manual',
  'desk-ops',
  'team-dossier',
  'pick-list-analysis',
  'playoff-summary',
  'pit-ops',
] as const;

export type CacheRefreshSurfaceId = (typeof CACHE_REFRESH_SURFACES)[number];

export const CACHE_REFRESH_SURFACE_LABELS: Record<CacheRefreshSurfaceId, string> = {
  bootstrap: 'Bootstrap',
  snapshot: 'Snapshot',
  'event-context': 'Event Context',
  'team-profile': 'Team Profile',
  'data-super': 'Data Super',
  'district-points': 'District Points',
  'game-manual': 'Game Manual',
  'desk-ops': 'Desk Ops',
  'team-dossier': 'Team Dossier',
  'pick-list-analysis': 'Pick List Analysis',
  'playoff-summary': 'Playoff Summary',
  'pit-ops': 'Pit Mode',
};

export function isCacheRefreshSurfaceId(value: string): value is CacheRefreshSurfaceId {
  return CACHE_REFRESH_SURFACES.includes(value as CacheRefreshSurfaceId);
}
