import postgres, { type Sql } from 'postgres';

import { getPostgresEnv, hasPostgresEnv } from './env';

type GlobalWithPostgres = typeof globalThis & {
  __tbsbPostgresClient?: Sql<Record<string, unknown>>;
};

export function getPostgresServerClient(): Sql<Record<string, unknown>> | null {
  if (!hasPostgresEnv()) return null;

  const globalScope = globalThis as GlobalWithPostgres;
  if (!globalScope.__tbsbPostgresClient) {
    const env = getPostgresEnv();
    globalScope.__tbsbPostgresClient = postgres(env.POSTGRES_URL, {
      connect_timeout: 15,
      idle_timeout: 20,
      max: 1,
      prepare: false,
    });
  }

  return globalScope.__tbsbPostgresClient;
}
