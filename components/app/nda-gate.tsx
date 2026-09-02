import type { ReactNode } from "react";
import { confirmNda } from "@/lib/entities/actions";
import { Button } from "@/components/ds/button";

export interface NdaGateProps {
  entityId: string;
  ndaRequired: boolean;
  ndaConfirmedAt: string | null;
  returnTo: string;
  children: ReactNode;
}

/**
 * NDA flag (this prompt): if set, show a banner and require the assessor
 * to confirm an NDA is in place before evidence can be opened. One
 * confirmation unlocks the entity's evidence for every staff member —
 * see docs/decisions.md — so this gates on nda_confirmed_at existing at
 * all, not on who confirmed it or when.
 */
export function NdaGate({ entityId, ndaRequired, ndaConfirmedAt, returnTo, children }: NdaGateProps) {
  if (!ndaRequired || ndaConfirmedAt) {
    return <>{children}</>;
  }

  return (
    <div className="rounded-ds-card border border-ds-warn bg-ds-surface p-4">
      <p className="text-sm font-medium text-ds-ink">NDA required</p>
      <p className="mt-1 text-sm text-ds-ink-2">
        This entity requires a non-disclosure agreement to be in place before its evidence can be opened. Confirm one is
        in place to continue.
      </p>
      <form action={confirmNda.bind(null, entityId, returnTo)} className="mt-3">
        <Button type="submit" variant="secondary">
          Confirm NDA is in place
        </Button>
      </form>
    </div>
  );
}
