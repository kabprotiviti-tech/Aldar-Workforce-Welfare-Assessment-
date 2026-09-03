"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { InspectionQueue } from "@/lib/inspection/queue";
import { createSender } from "@/lib/inspection/sync-client";
import { Button } from "@/components/ds/button";

/**
 * The unsynced count and the sync itself (this prompt: "a visible
 * unsynced count and no data loss on app close").
 *
 * Sticky at the top of the inspection on purpose. On a phone, in a
 * building with no signal, the one thing an assessor needs to be able to
 * check at a glance is whether their morning's work is still only on the
 * device.
 */
function subscribeToConnectivity(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

export function useInspectionQueue() {
  // Lazy state rather than a ref written during render: the queue opens
  // IndexedDB, so it must not be constructed on the server at all.
  const [queue] = useState<InspectionQueue | null>(() => (typeof window === "undefined" ? null : new InspectionQueue()));
  const [unsynced, setUnsynced] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  // useSyncExternalStore is the right shape for connectivity: it reads
  // navigator.onLine on every render without a setState-in-effect, and
  // its server snapshot keeps hydration consistent.
  const online = useSyncExternalStore(
    subscribeToConnectivity,
    () => navigator.onLine,
    () => true,
  );

  const refresh = useCallback(async () => {
    if (!queue) return;
    setUnsynced(await queue.unsyncedCount());
  }, [queue]);

  // The in-flight guard lives in a ref, not in `syncing`: keeping it out
  // of the dependency list is what makes `sync` a stable function, and a
  // stable `sync` is what stops the reconnect listener below from being
  // torn down and re-registered on every state change.
  const syncingRef = useRef(false);

  const sync = useCallback(async () => {
    if (!queue || syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    setLastError(null);
    try {
      const result = await queue.sync(createSender());
      if (result.failed > 0) setLastError(`${result.failed} item(s) still queued — they will retry.`);
    } catch (err) {
      setLastError(err instanceof Error ? err.message : String(err));
    } finally {
      syncingRef.current = false;
      setSyncing(false);
      await refresh();
    }
  }, [queue, refresh]);

  // Reconnecting is the moment that matters: the assessor walks out of
  // the building and the queue should drain without them thinking about
  // it. The drain is triggered from the "online" event handler rather
  // than from the effect body, and the first-load drain waits on the
  // count read, so nothing sets state synchronously during the effect.
  useEffect(() => {
    if (!queue) return;
    let cancelled = false;
    const drain = () => {
      if (!cancelled) void sync();
    };
    window.addEventListener("online", drain);
    void queue.unsyncedCount().then((count) => {
      if (cancelled) return;
      setUnsynced(count);
      if (count > 0 && navigator.onLine) drain();
    });
    return () => {
      cancelled = true;
      window.removeEventListener("online", drain);
    };
  }, [queue, sync]);

  const enqueue = useCallback(
    async (mutation: Parameters<InspectionQueue["enqueue"]>[0]) => {
      if (!queue) return;
      await queue.enqueue(mutation);
      await refresh();
      if (navigator.onLine) void sync();
    },
    [queue, refresh, sync],
  );

  return { unsynced, syncing, online, lastError, sync, enqueue, refresh };
}

export function SyncStatusBar({
  unsynced,
  syncing,
  online,
  lastError,
  onSync,
}: {
  unsynced: number;
  syncing: boolean;
  online: boolean;
  lastError: string | null;
  onSync: () => void;
}) {
  return (
    <div className="sticky top-0 z-10 -mx-4 border-b border-ds-line bg-ds-surface px-4 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className={`inline-block h-2 w-2 rounded-full ${online ? "bg-ds-ok" : "bg-ds-warn"}`}
          />
          <span className="text-xs font-medium text-ds-ink">
            {online ? "Online" : "Offline — captures are saved on this device"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs tabular-nums text-ds-ink-2" aria-live="polite">
            {unsynced === 0 ? "All synced" : `${unsynced} unsynced`}
          </span>
          {unsynced > 0 && (
            <Button variant="secondary" className="px-2 py-1 text-xs" disabled={syncing || !online} onClick={onSync}>
              {syncing ? "Syncing…" : "Sync now"}
            </Button>
          )}
        </div>
      </div>
      {lastError && <p className="mt-1 text-xs text-ds-warn">{lastError}</p>}
    </div>
  );
}
