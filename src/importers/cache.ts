import type { Bbox } from './overpass';

async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('cityflows-imports', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('extracts');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Tile keys are separate from versioned Overpass bbox keys in the same store. */
export async function cachedTerrainTile(
  key: string,
  bytes?: Uint8Array,
): Promise<Uint8Array | undefined> {
  if (typeof indexedDB === 'undefined') return undefined;
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('extracts', bytes ? 'readwrite' : 'readonly');
      const store = transaction.objectStore('extracts');
      const request = bytes ? store.put(bytes, `terrarium:${key}`) : store.get(`terrarium:${key}`);
      transaction.oncomplete = () => resolve(bytes ?? (request.result as Uint8Array | undefined));
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('Terrain cache transaction aborted'));
    });
  } finally {
    db.close();
  }
}

export async function cachedExtract(bbox: Bbox, xml?: string): Promise<string | undefined> {
  const { queryVersion } = await import('./overpass');
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('extracts', xml === undefined ? 'readonly' : 'readwrite');
      const store = transaction.objectStore('extracts');
      const key = JSON.stringify([queryVersion, bbox]);
      const request = xml === undefined ? store.get(key) : store.put(xml, key);
      transaction.oncomplete = () =>
        resolve(xml === undefined ? (request.result as string | undefined) : xml);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('Import cache transaction aborted'));
    });
  } finally {
    db.close();
  }
}
