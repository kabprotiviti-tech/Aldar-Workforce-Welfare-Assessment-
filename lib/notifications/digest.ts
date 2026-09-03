import type { Signal } from "@/lib/dashboard/signals";

/**
 * "Daily digest per assessor" (this prompt) — one plain-text email
 * built from the same evidence-based signals the executive overview
 * shows (lib/dashboard/signals.ts), scoped to one assessor's own
 * portfolio. Pure: given the signals already gathered for that
 * assessor, produce the subject/body; the adapter decides which
 * assessments belong to them and sends the mail.
 */

export interface DigestEmail {
  subject: string;
  text: string;
}

export function buildDigestEmail(ownerName: string, signals: readonly Signal[]): DigestEmail {
  const nonEmpty = signals.filter((signal) => signal.items.length > 0);
  const totalItems = nonEmpty.reduce((sum, signal) => sum + signal.items.length, 0);

  if (nonEmpty.length === 0) {
    return {
      subject: "Daily digest — nothing needs attention",
      text: `Hi ${ownerName},\n\nNothing on your portfolio needs attention today.`,
    };
  }

  const sections = nonEmpty.map((signal) => {
    const lines = signal.items.map((item) => `  - ${item.label} — ${item.detail}`);
    return `${signal.title} (${signal.items.length}):\n${lines.join("\n")}`;
  });

  return {
    subject: `Daily digest — ${totalItems} item${totalItems === 1 ? "" : "s"} need${totalItems === 1 ? "s" : ""} attention`,
    text: `Hi ${ownerName},\n\n${sections.join("\n\n")}`,
  };
}
