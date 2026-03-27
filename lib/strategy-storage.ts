import type { StrategyRecord, StrategyRecordSummary } from './strategy-types';

const DB_NAME = 'tbsb_strategy_records_v1';
const STORE_NAME = 'strategies';
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB is not available in this environment.'));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('updatedAtMs', 'updatedAtMs');
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB.'));
  });
}

function makeTransaction<T>(
  mode: IDBTransactionMode,
  executor: (
    store: IDBObjectStore,
    resolve: (value: T) => void,
    reject: (error: Error) => void,
  ) => void,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        const store = tx.objectStore(STORE_NAME);

        tx.oncomplete = () => db.close();
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed.'));
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted.'));

        executor(store, resolve, reject);
      }),
  );
}

export function makeStrategyRecordId(eventKey: string, matchKey: string): string {
  return `${eventKey}__${matchKey}`;
}

export async function getStrategyRecord(
  eventKey: string,
  matchKey: string,
): Promise<StrategyRecord | null> {
  const id = makeStrategyRecordId(eventKey, matchKey);
  return getStrategyRecordById(id);
}

export async function getStrategyRecordById(id: string): Promise<StrategyRecord | null> {
  return makeTransaction<StrategyRecord | null>('readonly', (store, resolve, reject) => {
    const request = store.get(id);
    request.onsuccess = () => resolve((request.result as StrategyRecord | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error('Failed to read strategy record.'));
  });
}

export async function saveStrategyRecord(record: StrategyRecord): Promise<void> {
  return makeTransaction<void>('readwrite', (store, resolve, reject) => {
    const request = store.put(record);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('Failed to save strategy record.'));
  });
}

export async function listStrategyRecords(): Promise<StrategyRecordSummary[]> {
  return makeTransaction<StrategyRecordSummary[]>('readonly', (store, resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => {
      const rows = ((request.result as StrategyRecord[] | undefined) ?? [])
        .sort((a, b) => b.updatedAtMs - a.updatedAtMs)
        .map((row) => ({
          id: row.id,
          eventKey: row.eventKey,
          matchKey: row.matchKey,
          matchLabel: row.matchLabel,
          eventName: row.eventName,
          status: row.status,
          updatedAtMs: row.updatedAtMs,
          allianceTeams: row.allianceTeams,
        }));
      resolve(rows);
    };
    request.onerror = () => reject(request.error ?? new Error('Failed to list strategy records.'));
  });
}
