import { describe, expect, it } from "vitest";
import { MAX_UPLOAD_BYTES, validateUpload } from "./upload-validation";

describe("validateUpload", () => {
  it.each(["pdf", "jpg", "jpeg", "png", "xlsx", "docx", "zip"])("accepts a .%s file within the size limit", (ext) => {
    expect(validateUpload({ filename: `report.${ext}`, sizeBytes: 1024 })).toEqual({ ok: true, extension: ext });
  });

  it("is case-insensitive on the extension", () => {
    expect(validateUpload({ filename: "REPORT.PDF", sizeBytes: 1024 })).toEqual({ ok: true, extension: "pdf" });
  });

  it("rejects an unsupported extension with a clear message", () => {
    const result = validateUpload({ filename: "malware.exe", sizeBytes: 1024 });
    expect(result).toEqual({
      ok: false,
      message: ".exe isn't an accepted file type. Allowed: PDF, JPG, PNG, XLSX, DOCX, ZIP.",
    });
  });

  it("rejects a file with no extension", () => {
    const result = validateUpload({ filename: "README", sizeBytes: 1024 });
    expect(result).toEqual({
      ok: false,
      message: "This file isn't an accepted file type. Allowed: PDF, JPG, PNG, XLSX, DOCX, ZIP.",
    });
  });

  it("accepts a file exactly at the 50MB limit", () => {
    expect(validateUpload({ filename: "scan.pdf", sizeBytes: MAX_UPLOAD_BYTES })).toEqual({ ok: true, extension: "pdf" });
  });

  it("rejects a file one byte over the 50MB limit, with the size in the message", () => {
    const result = validateUpload({ filename: "scan.pdf", sizeBytes: MAX_UPLOAD_BYTES + 1 });
    expect(result).toEqual({ ok: false, message: "This file is 50.0MB — the limit is 50MB." });
  });

  it("rejects an empty file", () => {
    expect(validateUpload({ filename: "empty.pdf", sizeBytes: 0 })).toEqual({
      ok: false,
      message: "The file appears to be empty.",
    });
  });

  it("accepts a 40MB scanned PDF (this prompt's acceptance-criterion size)", () => {
    const fortyMb = 40 * 1024 * 1024;
    expect(validateUpload({ filename: "site-scan.pdf", sizeBytes: fortyMb })).toEqual({ ok: true, extension: "pdf" });
  });
});
