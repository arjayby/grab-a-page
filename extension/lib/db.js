let database;
function open() {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open('grab-a-page', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('sessions', { keyPath: 'id' });
      db.createObjectStore('tiles', { keyPath: 'key' }).createIndex('sessionId', 'sessionId');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return database;
}
async function transaction(store, mode, operation) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    let value;
    const request = operation(tx.objectStore(store));
    request.onsuccess = () => { value = request.result; };
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error || request.error);
    tx.onabort = () => reject(tx.error || new Error('Local storage transaction was interrupted.'));
  });
}
export const putSession = session => transaction('sessions', 'readwrite', store => store.put(session));
export const getSession = id => transaction('sessions', 'readonly', store => store.get(id));
export const putTile = tile => transaction('tiles', 'readwrite', store => store.put(tile));
export const getTile = key => transaction('tiles', 'readonly', store => store.get(key));
export async function deleteSession(id) {
  const db = await open();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['sessions', 'tiles'], 'readwrite');
    tx.objectStore('sessions').delete(id);
    const cursor = tx.objectStore('tiles').index('sessionId').openCursor(IDBKeyRange.only(id));
    cursor.onsuccess = () => { if (cursor.result) { cursor.result.delete(); cursor.result.continue(); } };
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
export async function pruneSessions(now = Date.now()) {
  const sessions = await transaction('sessions', 'readonly', store => store.getAll());
  for (const session of sessions) if (now - session.createdAt > 24 * 60 * 60 * 1000) await deleteSession(session.id);
}
