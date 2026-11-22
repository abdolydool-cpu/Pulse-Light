import {
  BandwidthConfig,
  ChatMessage,
  ChatRoom,
  OutboxEntry,
  UserProfile,
} from '../core/types';

const DB_NAME = 'pulselite_offline_v1';
const DB_VERSION = 1;

const STORES = {
  META: 'meta',
  ROOMS: 'rooms',
  MESSAGES: 'messages',
  OUTBOX: 'outbox',
} as const;

export interface WorkspaceSnapshot {
  profile: UserProfile | null;
  bandwidthConfig: BandwidthConfig;
  rooms: ChatRoom[];
  messagesByRoom: Record<string, ChatMessage[]>;
  outbox: OutboxEntry[];
  seqCounter: number;
}

const DEFAULT_BANDWIDTH_CONFIG: BandwidthConfig = {
  lowDataMode: true,
  simulatedCondition: 'auto',
  deferMediaToWifi: true,
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORES.META)) {
        db.createObjectStore(STORES.META, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORES.ROOMS)) {
        db.createObjectStore(STORES.ROOMS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.MESSAGES)) {
        const msgStore = db.createObjectStore(STORES.MESSAGES, { keyPath: 'id' });
        msgStore.createIndex('by_room', 'roomId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.OUTBOX)) {
        db.createObjectStore(STORES.OUTBOX, { keyPath: 'messageId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB'));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction error'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

function reqPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request error'));
  });
}

export async function loadWorkspaceSnapshot(): Promise<WorkspaceSnapshot> {
  try {
    const db = await openDb();
    const tx = db.transaction(
      [STORES.META, STORES.ROOMS, STORES.MESSAGES, STORES.OUTBOX],
      'readonly'
    );

    const [metaRows, rooms, messages, outbox] = await Promise.all([
      reqPromise<Array<{ key: string; value: unknown }>>(tx.objectStore(STORES.META).getAll()),
      reqPromise<ChatRoom[]>(tx.objectStore(STORES.ROOMS).getAll()),
      reqPromise<ChatMessage[]>(tx.objectStore(STORES.MESSAGES).getAll()),
      reqPromise<OutboxEntry[]>(tx.objectStore(STORES.OUTBOX).getAll()),
    ]);

    db.close();

    const metaMap = new Map(metaRows.map((r) => [r.key, r.value]));
    const profile = (metaMap.get('profile') as UserProfile | undefined) ?? null;
    const bandwidthConfig =
      (metaMap.get('bandwidthConfig') as BandwidthConfig | undefined) ??
      DEFAULT_BANDWIDTH_CONFIG;
    const seqCounter = (metaMap.get('seqCounter') as number | undefined) ?? 100;

    const messagesByRoom: Record<string, ChatMessage[]> = {};
    for (const msg of messages) {
      if (!messagesByRoom[msg.roomId]) {
        messagesByRoom[msg.roomId] = [];
      }
      messagesByRoom[msg.roomId].push(msg);
    }

    return {
      profile,
      bandwidthConfig,
      rooms,
      messagesByRoom,
      outbox,
      seqCounter,
    };
  } catch {
    return {
      profile: null,
      bandwidthConfig: DEFAULT_BANDWIDTH_CONFIG,
      rooms: [],
      messagesByRoom: {},
      outbox: [],
      seqCounter: 100,
    };
  }
}

export async function saveMetaValue(key: string, value: unknown): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORES.META, 'readwrite');
    tx.objectStore(STORES.META).put({ key, value });
    await txDone(tx);
    db.close();
  } catch {
    // Graceful no-op in restricted environments
  }
}

export async function saveRoomsBulk(rooms: ChatRoom[]): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORES.ROOMS, 'readwrite');
    const store = tx.objectStore(STORES.ROOMS);
    for (const room of rooms) {
      store.put(room);
    }
    await txDone(tx);
    db.close();
  } catch {
    // Graceful fallback
  }
}

export async function saveMessagesBulk(messages: ChatMessage[]): Promise<void> {
  if (messages.length === 0) return;
  try {
    const db = await openDb();
    const tx = db.transaction(STORES.MESSAGES, 'readwrite');
    const store = tx.objectStore(STORES.MESSAGES);
    for (const msg of messages) {
      store.put(msg);
    }
    await txDone(tx);
    db.close();
  } catch {
    // Graceful fallback
  }
}

export async function replaceOutboxQueue(outbox: OutboxEntry[]): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORES.OUTBOX, 'readwrite');
    const store = tx.objectStore(STORES.OUTBOX);
    store.clear();
    for (const entry of outbox) {
      store.put(entry);
    }
    await txDone(tx);
    db.close();
  } catch {
    // Graceful fallback
  }
}
