import "server-only";

/** "pending" isn't a possible scan result — it's only the DB column's initial value before any scan runs. */
export type VirusScanVerdict = "clean" | "infected" | "error";

export interface VirusScanner {
  scan(fileBytes: Uint8Array, fileName: string): Promise<VirusScanVerdict>;
}

/**
 * Virus scan hook (this prompt: "stub is acceptable for MVP, wired so it
 * can be swapped for a real scanner"). Always reports "clean" — every
 * caller goes through the VirusScanner interface, never this
 * implementation directly, so swapping in a real scanner (ClamAV, a
 * cloud AV API) later is a one-file change plus setActiveScanner() below,
 * not a rewrite of the upload path.
 */
export const stubVirusScanner: VirusScanner = {
  async scan() {
    return "clean";
  },
};

let activeScanner: VirusScanner = stubVirusScanner;

export function setVirusScanner(scanner: VirusScanner): void {
  activeScanner = scanner;
}

export async function scanForVirus(fileBytes: Uint8Array, fileName: string): Promise<VirusScanVerdict> {
  try {
    return await activeScanner.scan(fileBytes, fileName);
  } catch {
    return "error";
  }
}
