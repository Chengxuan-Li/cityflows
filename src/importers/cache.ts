import { queryVersion, type Bbox } from './overpass';

async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('cityflows-imports', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('extracts');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function cachedExtract(bbox: Bbox, xml?: string): Promise<string | undefined> {
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
