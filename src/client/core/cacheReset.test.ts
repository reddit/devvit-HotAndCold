import { expect, it } from 'vitest';
import { resetGuessCache } from './guess';

it('clears downloaded stores even while a connection is open, without touching player storage', async () => {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('guess-cache-v1', 3);
    request.onupgradeneeded = () => {
      for (const store of ['parsed-maps', 'lemma-map'])
        if (!request.result.objectStoreNames.contains(store))
          request.result.createObjectStore(store);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const read = (store: string) =>
    new Promise<number>((resolve, reject) => {
      const request = db.transaction(store).objectStore(store).count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['parsed-maps', 'lemma-map'], 'readwrite');
      tx.objectStore('parsed-maps').put({ word: 'download' }, 'a');
      tx.objectStore('lemma-map').put({ word: 'lemma' }, 'lemma');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    localStorage.setItem('guess-history:cache-test', 'kept');
    sessionStorage.setItem('nav-page:cache-test', 'win');
    await resetGuessCache();
    expect(await read('parsed-maps')).toBe(0);
    expect(await read('lemma-map')).toBe(0);
    expect(localStorage.getItem('guess-history:cache-test')).toBe('kept');
    expect(sessionStorage.getItem('nav-page:cache-test')).toBe('win');
  } finally {
    db.close();
    localStorage.removeItem('guess-history:cache-test');
    sessionStorage.removeItem('nav-page:cache-test');
  }
});
