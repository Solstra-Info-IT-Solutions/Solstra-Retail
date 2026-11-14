import { api } from './client';

export type QueuedOfflineSale = {
  idempotencyKey: string;
  payload: Record<string, unknown>;
  createdAt: string;
  lastError?: string;
};

const DB_NAME = 'solstra-retail-offline';
const STORE = 'sales';
const PRODUCT_STORE = 'products';

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'idempotencyKey' });
      if (!db.objectStoreNames.contains(PRODUCT_STORE)) db.createObjectStore(PRODUCT_STORE, { keyPath: '_id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Offline storage unavailable'));
  });
}

export async function queueOfflineSale(payload: Record<string, unknown>) {
  const idempotencyKey = String(payload.idempotencyKey || '');
  if (!idempotencyKey) throw new Error('Offline sale requires an idempotency key');
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ idempotencyKey, payload, createdAt: new Date().toISOString() } satisfies QueuedOfflineSale);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Could not save offline invoice'));
  });
  db.close();
}

export async function listQueuedOfflineSales(): Promise<QueuedOfflineSale[]> {
  const db = await database();
  const rows = await new Promise<QueuedOfflineSale[]>((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    request.onsuccess = () => resolve(request.result as QueuedOfflineSale[]);
    request.onerror = () => reject(request.error || new Error('Could not read offline invoices'));
  });
  db.close();
  return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function syncQueuedOfflineSales() {
  const queued = await listQueuedOfflineSales();
  if (!queued.length) return { synced: 0, pending: 0 };
  const response = await api.post<{ results: Array<{ idempotencyKey: string; status: string; error?: string }> }>('/platform/offline/sync', {
    operations: queued.map(item => ({ type: 'SALE', idempotencyKey: item.idempotencyKey, payload: item.payload })),
  });
  const results = response.data.results || [];
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const result of results) {
      const item = queued.find(row => row.idempotencyKey === result.idempotencyKey);
      if (!item) continue;
      if (result.status === 'SUCCEEDED') store.delete(result.idempotencyKey);
      else if (result.status === 'FAILED') store.put({ ...item, lastError: result.error || 'Sync failed' });
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Could not update offline queue'));
  });
  db.close();
  const remaining = await listQueuedOfflineSales();
  return { synced: results.filter(row => row.status === 'SUCCEEDED').length, pending: remaining.length };
}

export async function cacheOfflineProducts(products: Array<Record<string, unknown>>) {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(PRODUCT_STORE, 'readwrite');
    const store = tx.objectStore(PRODUCT_STORE);
    for (const product of products) store.put(product);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Could not cache product catalogue'));
  });
  db.close();
}

export async function getOfflineProducts<T>(): Promise<T[]> {
  const db = await database();
  const rows = await new Promise<T[]>((resolve, reject) => {
    const request = db.transaction(PRODUCT_STORE, 'readonly').objectStore(PRODUCT_STORE).getAll();
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error || new Error('Could not read cached product catalogue'));
  });
  db.close();
  return rows;
}
