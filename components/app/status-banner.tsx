export function StatusBanner({ error, success }: { error?: string; success?: string }) {
  if (!error && !success) return null;
  return (
    <div
      className={`mb-4 rounded-ds-card border px-4 py-3 text-sm ${
        error ? "border-ds-bad bg-ds-surface text-ds-bad" : "border-ds-ok bg-ds-surface text-ds-ok"
      }`}
    >
      {error ?? success}
    </div>
  );
}
