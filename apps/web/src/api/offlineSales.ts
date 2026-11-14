import { api } from './client';

export type QueuedOfflineSale = {
  idempotencyKey: string;
  queueId: string;
  scope: string;
  payload: Record<string, unknown>;
  createdAt: string;
  lastError?: string;
  attempts?: number;
  nextAttemptAt?: string;
  lastAttemptAt?: string;
  blocked?: boolean;
};

const DB_NAME = 'solstra-retail-offline';
const STORE = 'sales_v3';
const PRODUCT_STORE = 'products_v3';

function createDeviceUuid(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  return hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);
}

function offlineDeviceId(scope: string): string {
  const key = 'solstra_offline_device_' + scope;
  let id = localStorage.getItem(key);
  if (!id) { id = createDeviceUuid(); localStorage.setItem(key, id); }
  return id;
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 3);
    request.onupgradeneeded = () => {
      const db = request.result;
      const tx = request.transaction;
      if (!db.objectStoreNames.contains(STORE)) {
        const sales = db.createObjectStore(STORE, { keyPath: 'queueId' });
        if (db.objectStoreNames.contains('sales')) {
          const cursorRequest = tx!.objectStore('sales').openCursor();
          cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result;
            if (!cursor) return;
            const row = cursor.value as QueuedOfflineSale;
            sales.put({ ...row, queueId: `${row.scope}::${row.idempotencyKey}` });
            cursor.continue();
          };
        }
      }
      if (!db.objectStoreNames.contains(PRODUCT_STORE)) {
        const products = db.createObjectStore(PRODUCT_STORE, { keyPath: 'cacheKey' });
        if (db.objectStoreNames.contains('products')) {
          const cursorRequest = tx!.objectStore('products').openCursor();
          cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result;
            if (!cursor) return;
            const row = cursor.value as Record<string, unknown>;
            const scope = String(row.scope || '');
            if (scope && row._id) products.put({ ...row, cacheKey: `${scope}::${String(row._id)}` });
            cursor.continue();
          };
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Offline storage unavailable'));
  });
}

export async function queueOfflineSale(payload: Record<string, unknown>, scope: string) {
  const idempotencyKey = String(payload.idempotencyKey || '');
  if (!scope) throw new Error('Offline sale requires an authenticated tenant scope');
  if (!idempotencyKey) throw new Error('Offline sale requires an idempotency key');
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ idempotencyKey, queueId: `${scope}::${idempotencyKey}`, scope, payload, createdAt: new Date().toISOString(), attempts: 0 } satisfies QueuedOfflineSale);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Could not save offline invoice'));
  });
  db.close();
}

export async function listQueuedOfflineSales(scope: string): Promise<QueuedOfflineSale[]> {
  const db = await database();
  const rows = await new Promise<QueuedOfflineSale[]>((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    request.onsuccess = () => resolve(request.result as QueuedOfflineSale[]);
    request.onerror = () => reject(request.error || new Error('Could not read offline invoices'));
  });
  db.close();
  return rows.filter(row => row.scope === scope).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function syncQueuedOfflineSales(scope: string) {
  let remaining = await listQueuedOfflineSales(scope);
  const deviceId = offlineDeviceId(scope);
  await api.post('/platform/offline/devices/register', { deviceId, label: 'Browser POS device' });
  let synced = 0;
  const maxBatches = Math.ceil(remaining.length / 100);
  for (let batchIndex = 0; batchIndex < maxBatches && remaining.length; batchIndex += 1) {
    const now = Date.now();
    const batch = remaining.filter(item => !item.blocked && (!item.nextAttemptAt || new Date(item.nextAttemptAt).getTime() <= now)).slice(0, 100);
    if (!batch.length) break;
    const response = await api.post<{ results: Array<{ idempotencyKey: string; status: string; error?: string }> }>('/platform/offline/sync', {
      deviceId,
      operations: batch.map(item => ({ type: 'SALE', idempotencyKey: item.idempotencyKey, payload: item.payload })),
    });
    const results = response.data.results || [];
    const db = await database();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      for (const result of results) {
        const item = batch.find(row => row.idempotencyKey === result.idempotencyKey);
        if (!item) continue;
        if (result.status === 'SUCCEEDED') store.delete(item.queueId);
        else if (result.status === 'CONFLICT') { store.put({ ...item, blocked: true, lastError: result.error || 'Invoice payload conflict; manual review required', lastAttemptAt: new Date().toISOString() }); }
        else if (result.status === 'FAILED') { const attempts = Number(item.attempts || 0) + 1; const delayMinutes = Math.min(60, 2 ** attempts); store.put({ ...item, attempts, lastError: result.error || 'Sync failed', lastAttemptAt: new Date().toISOString(), nextAttemptAt: new Date(Date.now() + delayMinutes * 60_000).toISOString() }); }
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Could not update offline queue'));
    });
    db.close();
    const batchSuccess = results.filter(row => row.status === 'SUCCEEDED').length;
    synced += batchSuccess;
    if (!batchSuccess) break;
    remaining = await listQueuedOfflineSales(scope);
  }
  remaining = await listQueuedOfflineSales(scope);
  return { synced, pending: remaining.length };
}

export async function cacheOfflineProducts(products: Array<Record<string, unknown>>, scope: string) {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(PRODUCT_STORE, 'readwrite');
    const store = tx.objectStore(PRODUCT_STORE);
    for (const product of products) store.put({ ...product, scope, cacheKey: `${scope}::${String(product._id)}`, cachedAt: new Date().toISOString() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Could not cache product catalogue'));
  });
  db.close();
}

export async function getOfflineProducts<T>(scope: string): Promise<T[]> {
  const db = await database();
  const rows = await new Promise<T[]>((resolve, reject) => {
    const request = db.transaction(PRODUCT_STORE, 'readonly').objectStore(PRODUCT_STORE).getAll();
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error || new Error('Could not read cached product catalogue'));
  });
  db.close();
  return rows.filter((row: any) => row.scope === scope);
}
