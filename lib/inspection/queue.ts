/**
 * The offline queue (this prompt): answers, quantitative fields and
 * photos captured on a phone in a labour accommodation with poor signal,
 * held in IndexedDB and synced when connectivity returns.
 *
 * Two properties matter more than anything else here, and both are
 * tested against real IndexedDB semantics (lib/inspection/queue.test.ts):
 *
 * 1. No data loss on app close. Every capture is written to IndexedDB
 *    before the UI acknowledges it, so a killed tab, a dead battery or a
 *    backgrounded browser loses nothing. A queue built in memory with a
 *    periodic flush would lose whatever was captured since the last
 *    flush, which on a site visit is the last few rooms.
 *
 * 2. Exactly once. Every mutation is given its id when the assessor
 *    takes the action, not when it syncs, and the server applies at most
 *    one mutation per id (0025_inspection_sync.sql). A retry after a
 *    timeout — the normal case on a bad connection, where the request
 *    arrived but the response didn't — therefore cannot duplicate it.
 */

export type MutationKind = "area_answer" | "area_quantitative" | "area_rating" | "room_count" | "photo" | "certificate";

export type QueueItemStatus = "pending" | "syncing" | "failed";

export interface QueuedMutation {
  /** Created on the phone at capture time. The server's idempotency key. */
  clientMutationId: string;
  assessmentId: string;
  kind: MutationKind;
  payload: Record<string, unknown>;
  /** Photo bytes, already compressed. Held here so the image survives an app close too. */
  blob?: Blob;
  capturedAt: string;
  status: QueueItemStatus;
  attempts: number;
  lastError?: string;
}

export const DB_NAME = "wwap-inspection";
export const STORE_NAME = "mutations";
const DB_VERSION = 1;

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "clientMutationId" });
        store.createIndex("status", "status");
        store.createIndex("capturedAt", "capturedAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** Sends one mutation. Resolves when the server has durably applied it (or reported it a duplicate). */
export type SendMutationFn = (mutation: QueuedMutation) => Promise<void>;

export interface SyncOutcome {
  synced: number;
  failed: number;
  /** Ids the server reported it had already applied — a retry that correctly changed nothing. */
  remaining: number;
}

export class InspectionQueue {
  private dbPromise: Promise<IDBDatabase>;

  constructor(private factory: IDBFactory = indexedDB) {
    this.dbPromise = openDatabase(this.factory);
  }

  /**
   * Writes a capture to durable storage. Returns only once IndexedDB has
   * committed, so a UI that awaits this can honestly tell the assessor
   * the capture is safe.
   */
  async enqueue(mutation: Omit<QueuedMutation, "status" | "attempts">): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction(STORE_NAME, "readwrite");
    // `put`, not `add`: re-saving the same clientMutationId is an edit of
    // an unsynced capture, not a second capture.
    tx.objectStore(STORE_NAME).put({ ...mutation, status: "pending", attempts: 0 } satisfies QueuedMutation);
    await transactionDone(tx);
  }

  async all(): Promise<QueuedMutation[]> {
    const db = await this.dbPromise;
    const tx = db.transaction(STORE_NAME, "readonly");
    const items = await promisify(tx.objectStore(STORE_NAME).getAll() as IDBRequest<QueuedMutation[]>);
    return [...items].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  }

  /** The count the UI shows. Anything not yet accepted by the server is unsynced, including failures. */
  async unsyncedCount(): Promise<number> {
    return (await this.all()).length;
  }

  async pending(): Promise<QueuedMutation[]> {
    return (await this.all()).filter((item) => item.status !== "syncing");
  }

  private async remove(clientMutationId: string): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(clientMutationId);
    await transactionDone(tx);
  }

  private async update(mutation: QueuedMutation): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(mutation);
    await transactionDone(tx);
  }

  /**
   * Drains the queue in capture order. A mutation is deleted only after
   * the server has accepted it, so a crash mid-sync leaves it queued for
   * the next attempt — where the server's idempotency, not the client's
   * memory, is what stops it being applied twice.
   *
   * Capture order matters: a room's counts should land before a photo
   * that references the same room, and an area's answers before its
   * rating.
   */
  async sync(send: SendMutationFn): Promise<SyncOutcome> {
    const items = await this.pending();
    let synced = 0;
    let failed = 0;

    for (const item of items) {
      try {
        await send(item);
        await this.remove(item.clientMutationId);
        synced += 1;
      } catch (err) {
        failed += 1;
        await this.update({
          ...item,
          status: "failed",
          attempts: item.attempts + 1,
          lastError: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { synced, failed, remaining: await this.unsyncedCount() };
  }

  async close(): Promise<void> {
    const db = await this.dbPromise;
    db.close();
  }
}

/** A stable id for a capture, generated at capture time on the device. */
export function newMutationId(): string {
  return crypto.randomUUID();
}

/**
 * Where a queued photo's bytes go in Storage. Derived from the mutation
 * id rather than a timestamp or a random name, so a retry after a failed
 * upload overwrites the same object instead of leaving an orphan behind —
 * the upload becomes idempotent for the same reason the mutation is.
 */
export function photoStoragePath(assessmentId: string, clientMutationId: string): string {
  return `inspection/${assessmentId}/${clientMutationId}.jpg`;
}
