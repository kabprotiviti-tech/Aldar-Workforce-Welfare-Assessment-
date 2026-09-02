import "server-only";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

/**
 * No email provider is configured in this project (no API key for one
 * exists in env — see lib/env/server.ts). Logs instead of sending, the
 * same "stub, wired so it can be swapped for the real thing" treatment
 * this prompt explicitly sanctions for the virus scanner
 * (lib/rfi/virus-scan.ts) — every caller goes through the EmailSender
 * interface above, so swapping this for a real provider (Resend, SES,
 * SendGrid) is a one-file change. See docs/decisions.md.
 */
export const consoleEmailSender: EmailSender = {
  async send(message) {

    console.log(`[email stub] to=${message.to} subject=${JSON.stringify(message.subject)}\n${message.text}`);
  },
};

let activeSender: EmailSender = consoleEmailSender;

export function setEmailSender(sender: EmailSender): void {
  activeSender = sender;
}

export async function sendEmail(message: EmailMessage): Promise<void> {
  await activeSender.send(message);
}
