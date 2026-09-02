/**
 * Server-side upload validation (this prompt): "Accept pdf, jpg, png,
 * xlsx, docx, zip. Max 50MB per file. Reject anything else with a clear
 * message." Gates on the file extension, not the browser-reported mime
 * type — mime sniffing is inconsistent across browsers and OSes (the
 * same .xlsx can arrive as the correct spreadsheet mime type, a generic
 * "application/octet-stream", or occasionally something else entirely,
 * depending on how the OS associates the extension), so it's not a
 * reliable *rejection* signal. The extension is. See docs/decisions.md.
 */

export const ALLOWED_EXTENSIONS = ["pdf", "jpg", "jpeg", "png", "xlsx", "docx", "zip"] as const;
export type AllowedExtension = (typeof ALLOWED_EXTENSIONS)[number];

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export type UploadValidationResult =
  | { ok: true; extension: AllowedExtension }
  | { ok: false; message: string };

export interface UploadValidationInput {
  filename: string;
  sizeBytes: number;
}

function extensionOf(filename: string): string | null {
  const match = /\.([a-zA-Z0-9]+)$/.exec(filename.trim());
  return match ? match[1]!.toLowerCase() : null;
}

function isAllowedExtension(ext: string): ext is AllowedExtension {
  return (ALLOWED_EXTENSIONS as readonly string[]).includes(ext);
}

export function validateUpload(input: UploadValidationInput): UploadValidationResult {
  const extension = extensionOf(input.filename);
  if (!extension || !isAllowedExtension(extension)) {
    const shown = extension ? `.${extension}` : "This file";
    return {
      ok: false,
      message: `${shown} isn't an accepted file type. Allowed: PDF, JPG, PNG, XLSX, DOCX, ZIP.`,
    };
  }

  if (input.sizeBytes <= 0) {
    return { ok: false, message: "The file appears to be empty." };
  }

  if (input.sizeBytes > MAX_UPLOAD_BYTES) {
    const sizeMb = (input.sizeBytes / (1024 * 1024)).toFixed(1);
    return { ok: false, message: `This file is ${sizeMb}MB — the limit is 50MB.` };
  }

  return { ok: true, extension };
}
