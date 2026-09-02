import { entityTypeSchema, entityStatusSchema, type EntityStatus, type EntityType } from "@/lib/db/core";

/**
 * CSV import for the client's annual entity list (this prompt). Hand-rolled
 * RFC4180-ish parsing rather than a dependency — quoted fields (embedded
 * commas, embedded newlines, escaped "" quotes) are the only real
 * complexity here and it is small enough to own and unit test directly.
 */
export function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let sawAnyContent = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      sawAnyContent = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
      sawAnyContent = true;
    } else if (char === "\r") {
      // normalized away; \n (bare or following \r) ends the row below.
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
      sawAnyContent = true;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  if (!sawAnyContent) {
    return [];
  }
  return rows.filter((r) => !(r.length === 1 && (r[0] ?? "").trim() === ""));
}

export interface ParsedContactImport {
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
}

export interface ParsedEntityImport {
  entityCode: string;
  name: string;
  type: EntityType;
  workerCount: number | null;
  projectName: string | null;
  projectType: string | null;
  status: EntityStatus;
  contacts: ParsedContactImport[];
}

export interface CsvRowError {
  /** 1-indexed, counting the header row as row 1 (matches what a spreadsheet shows). */
  row: number;
  message: string;
}

export interface ParseEntityCsvResult {
  entities: ParsedEntityImport[];
  errors: CsvRowError[];
}

const REQUIRED_COLUMNS = ["entity_code", "entity_name", "type"] as const;

function parseBoolean(value: string): boolean {
  return ["true", "yes", "y", "1"].includes(value.trim().toLowerCase());
}

function blank(value: string | undefined): string {
  return (value ?? "").trim();
}

/**
 * Parses the client's annual entity list. One row per entity, or one row
 * per (entity, contact) pair with entity fields repeated across rows that
 * share the same entity_code — either shape works, since rows are grouped
 * by entity_code and every contact-bearing row contributes one contact.
 * When the same entity_code's fields differ across its rows, the last row
 * seen wins (lets a corrected later row override an earlier one in the
 * same file). See docs/decisions.md.
 *
 * Fails closed: if this returns any errors, the caller must not write
 * anything — a partial import of a client-supplied list is worse than no
 * import.
 */
export function parseEntityCsv(text: string): ParseEntityCsvResult {
  const rows = parseCsvText(text);
  if (rows.length === 0) {
    return { entities: [], errors: [{ row: 1, message: "The file is empty." }] };
  }

  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length > 0) {
    return {
      entities: [],
      errors: [{ row: 1, message: `Missing required column(s): ${missing.join(", ")}.` }],
    };
  }

  const colIndex = new Map(header.map((name, index) => [name, index]));
  const value = (row: string[], column: string): string => blank(row[colIndex.get(column) ?? -1]);

  const entities = new Map<string, ParsedEntityImport>();
  const errors: CsvRowError[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]!;
    const rowNumber = i + 1;
    if (row.every((cell) => cell.trim() === "")) {
      continue;
    }

    const entityCode = value(row, "entity_code");
    const name = value(row, "entity_name");
    const typeRaw = value(row, "type").toLowerCase();

    if (!entityCode) {
      errors.push({ row: rowNumber, message: "entity_code is required." });
      continue;
    }
    if (!name) {
      errors.push({ row: rowNumber, message: "entity_name is required." });
      continue;
    }
    const typeResult = entityTypeSchema.safeParse(typeRaw);
    if (!typeResult.success) {
      errors.push({
        row: rowNumber,
        message: `type "${typeRaw}" is not one of: ${entityTypeSchema.options.join(", ")}.`,
      });
      continue;
    }

    const workerCountRaw = value(row, "worker_count");
    let workerCount: number | null = null;
    if (workerCountRaw) {
      const parsed = Number.parseInt(workerCountRaw, 10);
      if (Number.isNaN(parsed)) {
        errors.push({ row: rowNumber, message: `worker_count "${workerCountRaw}" is not a whole number.` });
        continue;
      }
      workerCount = parsed;
    }

    const statusRaw = value(row, "status").toLowerCase();
    let status: EntityStatus = "active";
    if (statusRaw) {
      const statusResult = entityStatusSchema.safeParse(statusRaw);
      if (!statusResult.success) {
        errors.push({
          row: rowNumber,
          message: `status "${statusRaw}" is not one of: ${entityStatusSchema.options.join(", ")}.`,
        });
        continue;
      }
      status = statusResult.data;
    }

    const contactName = value(row, "contact_name");
    const contactEmail = value(row, "contact_email");
    const contacts: ParsedContactImport[] = [];
    if (contactName || contactEmail) {
      if (!contactName) {
        errors.push({ row: rowNumber, message: "contact_name is required when a contact is given." });
        continue;
      }
      contacts.push({
        name: contactName,
        role: value(row, "contact_role") || null,
        email: contactEmail || null,
        phone: value(row, "contact_phone") || null,
        isPrimary: parseBoolean(value(row, "contact_is_primary")),
      });
    }

    const existing = entities.get(entityCode);
    const entity: ParsedEntityImport = {
      entityCode,
      name,
      type: typeResult.data,
      workerCount,
      projectName: value(row, "project_name") || null,
      projectType: value(row, "project_type") || null,
      status,
      contacts: existing ? [...existing.contacts, ...contacts] : contacts,
    };
    entities.set(entityCode, entity);
  }

  return { entities: Array.from(entities.values()), errors };
}
