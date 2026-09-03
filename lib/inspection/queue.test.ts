import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InspectionQueue, photoStoragePath, type QueuedMutation, type SendMutationFn } from "./queue";
import { ACCOMMODATION_AREA_TITLES } from "@/lib/db/accommodation-quantitative";

/**
 * The airplane-mode acceptance criterion (this prompt): "complete a full
 * 12-area inspection with 20 photos offline, reconnect, everything syncs
 * exactly once with no duplicates."
 *
 * Run against fake-indexeddb, which implements the real IndexedDB
 * semantics — transactions, durability across a closed connection, key
 * uniqueness — rather than a Map pretending to be a database. Offline is
 * simulated the way it actually presents on site: the send function
 * rejects. The duplicate half is checked by counting what the server
 * received, keyed by mutation id.
 */
let factory: IDBFactory;
let queue: InspectionQueue;

/** A server that records what it applied, and refuses to apply an id twice — like 0025's sync log. */
function fakeServer() {
  const applied = new Map<string, QueuedMutation>();
  const duplicateAttempts: string[] = [];
  let offline = false;
  let failNext = 0;

  const send: SendMutationFn = async (mutation) => {
    if (offline) throw new Error("Network request failed");
    if (failNext > 0) {
      failNext -= 1;
      throw new Error("Timed out");
    }
    if (applied.has(mutation.clientMutationId)) {
      // The real endpoint reports a duplicate rather than applying it
      // again; the client treats that as success and drops the item.
      duplicateAttempts.push(mutation.clientMutationId);
      return;
    }
    applied.set(mutation.clientMutationId, mutation);
  };

  return {
    send,
    applied,
    duplicateAttempts,
    goOffline: () => {
      offline = true;
    },
    goOnline: () => {
      offline = false;
    },
    failNextSends: (count: number) => {
      failNext = count;
    },
  };
}

function captureAt(index: number): string {
  return new Date(Date.UTC(2026, 5, 1, 8, 0, index)).toISOString();
}

beforeEach(() => {
  factory = new IDBFactory();
  queue = new InspectionQueue(factory);
});

afterEach(async () => {
  await queue.close();
});

describe("the offline queue holds captures durably", () => {
  it("keeps a capture across an app close — a new queue over the same database still has it", async () => {
    await queue.enqueue({
      clientMutationId: "m-1",
      assessmentId: "a-1",
      kind: "area_rating",
      payload: { compliance_status: "Compliant" },
      capturedAt: captureAt(1),
    });
    await queue.close();

    // A killed tab, a dead battery, the browser evicting the page: the
    // next launch opens the same IndexedDB.
    const reopened = new InspectionQueue(factory);
    expect(await reopened.unsyncedCount()).toBe(1);
    expect((await reopened.all())[0]!.payload).toEqual({ compliance_status: "Compliant" });
    await reopened.close();
  });

  it("keeps photo bytes, not just the metadata", async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/jpeg" });
    await queue.enqueue({ clientMutationId: "p-1", assessmentId: "a-1", kind: "photo", payload: {}, blob, capturedAt: captureAt(1) });
    await queue.close();

    const reopened = new InspectionQueue(factory);
    const stored = (await reopened.all())[0]!;
    expect(stored.blob).toBeInstanceOf(Blob);
    expect(await stored.blob!.arrayBuffer()).toEqual(await blob.arrayBuffer());
    await reopened.close();
  });

  it("counts everything not yet accepted by the server as unsynced", async () => {
    for (let index = 0; index < 3; index++) {
      await queue.enqueue({ clientMutationId: `m-${index}`, assessmentId: "a-1", kind: "area_answer", payload: {}, capturedAt: captureAt(index) });
    }

    expect(await queue.unsyncedCount()).toBe(3);
  });

  it("treats a re-save of the same capture as an edit, not a second capture", async () => {
    await queue.enqueue({ clientMutationId: "m-1", assessmentId: "a-1", kind: "area_answer", payload: { answer: "Yes" }, capturedAt: captureAt(1) });
    await queue.enqueue({ clientMutationId: "m-1", assessmentId: "a-1", kind: "area_answer", payload: { answer: "No" }, capturedAt: captureAt(1) });

    const all = await queue.all();
    expect(all).toHaveLength(1);
    expect(all[0]!.payload).toEqual({ answer: "No" });
  });

  it("drains in capture order, so a room's counts land before a photo of that room", async () => {
    const server = fakeServer();
    await queue.enqueue({ clientMutationId: "room", assessmentId: "a-1", kind: "room_count", payload: {}, capturedAt: captureAt(1) });
    await queue.enqueue({ clientMutationId: "photo", assessmentId: "a-1", kind: "photo", payload: {}, capturedAt: captureAt(2) });

    await queue.sync(server.send);

    expect([...server.applied.keys()]).toEqual(["room", "photo"]);
  });
});

describe("airplane mode: a full 12-area inspection with 20 photos", () => {
  /** Captures the whole inspection the way an assessor would, in order. */
  async function captureFullInspection(): Promise<number> {
    let clock = 0;
    let count = 0;

    for (const slNo of Object.keys(ACCOMMODATION_AREA_TITLES).map(Number)) {
      const itemId = `item-${slNo}`;

      await queue.enqueue({
        clientMutationId: `answer-${slNo}`,
        assessmentId: "a-1",
        kind: "area_answer",
        payload: { assessment_item_id: itemId, question_id: `q-${slNo}`, answer: "Yes" },
        capturedAt: captureAt(clock++),
      });
      count += 1;

      await queue.enqueue({
        clientMutationId: `quant-${slNo}`,
        assessmentId: "a-1",
        kind: "area_quantitative",
        payload: { assessment_item_id: itemId, quantitative: { residents_per_toilet: 8 } },
        capturedAt: captureAt(clock++),
      });
      count += 1;

      await queue.enqueue({
        clientMutationId: `rating-${slNo}`,
        assessmentId: "a-1",
        kind: "area_rating",
        payload: { assessment_item_id: itemId, compliance_status: "Compliant" },
        capturedAt: captureAt(clock++),
      });
      count += 1;
    }

    // Two rooms physically counted by the assessor.
    for (const roomRef of ["A-101", "A-102"]) {
      await queue.enqueue({
        clientMutationId: `room-${roomRef}`,
        assessmentId: "a-1",
        kind: "room_count",
        payload: { room_ref: roomRef, bed_count: 8, occupancy_count: 8 },
        capturedAt: captureAt(clock++),
      });
      count += 1;
    }

    for (let index = 0; index < 20; index++) {
      await queue.enqueue({
        clientMutationId: `photo-${index}`,
        assessmentId: "a-1",
        kind: "photo",
        payload: { storage_path: photoStoragePath("a-1", `photo-${index}`), room_ref: index % 2 === 0 ? "A-101" : "A-102" },
        blob: new Blob([new Uint8Array([index])], { type: "image/jpeg" }),
        capturedAt: captureAt(clock++),
      });
      count += 1;
    }

    return count;
  }

  it("captures everything offline, then syncs each mutation exactly once", async () => {
    const server = fakeServer();
    server.goOffline();

    const captured = await captureFullInspection();
    expect(captured).toBe(58); // 12 areas x 3 + 2 rooms + 20 photos
    expect(await queue.unsyncedCount()).toBe(58);

    // Trying to sync with no signal changes nothing but the attempt count.
    const offlineAttempt = await queue.sync(server.send);
    expect(offlineAttempt).toEqual({ synced: 0, failed: 58, remaining: 58 });
    expect(server.applied.size).toBe(0);

    server.goOnline();
    const reconnected = await queue.sync(server.send);

    expect(reconnected).toEqual({ synced: 58, failed: 0, remaining: 0 });
    expect(server.applied.size).toBe(58);
    expect(await queue.unsyncedCount()).toBe(0);
    expect(server.duplicateAttempts).toEqual([]);
  });

  it("survives being closed mid-inspection and syncs the whole thing afterwards", async () => {
    const server = fakeServer();
    server.goOffline();
    await captureFullInspection();
    await queue.close();

    const reopened = new InspectionQueue(factory);
    expect(await reopened.unsyncedCount()).toBe(58);

    server.goOnline();
    const result = await reopened.sync(server.send);

    expect(result.synced).toBe(58);
    expect(server.applied.size).toBe(58);
    await reopened.close();
  });

  it("does not duplicate when a sync is interrupted and retried", async () => {
    const server = fakeServer();
    server.goOffline();
    await captureFullInspection();
    server.goOnline();

    // The tunnel: the first ten sends fail after arriving nowhere, then
    // the connection returns mid-drain.
    server.failNextSends(10);
    const first = await queue.sync(server.send);
    expect(first.failed).toBe(10);
    expect(first.synced).toBe(48);

    const second = await queue.sync(server.send);
    expect(second.synced).toBe(10);
    expect(await queue.unsyncedCount()).toBe(0);

    // 58 distinct mutations applied, no id twice.
    expect(server.applied.size).toBe(58);
    expect(server.duplicateAttempts).toEqual([]);
  });

  it("does not duplicate when the response is lost after the server applied it", async () => {
    // The genuinely dangerous case on a bad connection: the request
    // arrived and was applied, the acknowledgement never came back, and
    // the client retries. Only the server's idempotency saves this.
    const server = fakeServer();
    await queue.enqueue({ clientMutationId: "m-1", assessmentId: "a-1", kind: "area_rating", payload: {}, capturedAt: captureAt(1) });

    const lossy: SendMutationFn = async (mutation) => {
      await server.send(mutation);
      throw new Error("Network changed");
    };

    const first = await queue.sync(lossy);
    expect(first.failed).toBe(1);
    expect(server.applied.size).toBe(1);
    expect(await queue.unsyncedCount()).toBe(1);

    // The retry reaches a server that has already applied this id.
    const second = await queue.sync(server.send);
    expect(second.synced).toBe(1);
    expect(server.applied.size).toBe(1);
    expect(server.duplicateAttempts).toEqual(["m-1"]);
    expect(await queue.unsyncedCount()).toBe(0);
  });

  it("records the error on a failed item so the assessor can see why it is stuck", async () => {
    const server = fakeServer();
    server.goOffline();
    await queue.enqueue({ clientMutationId: "m-1", assessmentId: "a-1", kind: "photo", payload: {}, capturedAt: captureAt(1) });

    await queue.sync(server.send);

    const item = (await queue.all())[0]!;
    expect(item.status).toBe("failed");
    expect(item.attempts).toBe(1);
    expect(item.lastError).toBe("Network request failed");
  });
});

describe("photoStoragePath", () => {
  it("derives the path from the mutation id, so a retried upload overwrites rather than orphans", () => {
    expect(photoStoragePath("a-1", "m-9")).toBe("inspection/a-1/m-9.jpg");
    expect(photoStoragePath("a-1", "m-9")).toBe(photoStoragePath("a-1", "m-9"));
  });
});
