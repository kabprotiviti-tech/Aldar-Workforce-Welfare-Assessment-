export type StatTone = "ok" | "warn" | "bad";

export interface StatProps {
  label: string;
  value: string | number;
  delta?: string;
  deltaTone?: StatTone;
  className?: string;
}

const DELTA_TONE_CLASSES: Record<StatTone, string> = {
  ok: "text-ds-ok",
  warn: "text-ds-warn",
  bad: "text-ds-bad",
};

export function Stat({ label, value, delta, deltaTone = "ok", className = "" }: StatProps) {
  return (
    <div className={className}>
      <p className="text-xs text-ds-ink-2">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-ds-ink">{value}</p>
      {delta && <p className={`mt-1 text-xs font-medium tabular-nums ${DELTA_TONE_CLASSES[deltaTone]}`}>{delta}</p>}
    </div>
  );
}
