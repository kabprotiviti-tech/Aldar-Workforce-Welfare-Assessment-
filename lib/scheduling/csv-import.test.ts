import { describe, expect, it } from "vitest";
import { parseCsvText, parseEntityCsv } from "./csv-import";

describe("parseCsvText", () => {
  it("splits plain rows and columns", () => {
    expect(parseCsvText("a,b,c\n1,2,3\n")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles a quoted field containing a comma", () => {
    expect(parseCsvText('a,"b,c",d\n')).toEqual([["a", "b,c", "d"]]);
  });

  it("handles an escaped double quote inside a quoted field", () => {
    expect(parseCsvText('a,"say ""hi""",c\n')).toEqual([["a", 'say "hi"', "c"]]);
  });

  it("handles CRLF line endings", () => {
    expect(parseCsvText("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("handles a file with no trailing newline", () => {
    expect(parseCsvText("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("returns nothing for an empty file", () => {
    expect(parseCsvText("")).toEqual([]);
  });

  it("skips blank lines", () => {
    expect(parseCsvText("a,b\n\n1,2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

const HEADER = "entity_code,entity_name,type,worker_count,status,contact_name,contact_email,contact_is_primary";

describe("parseEntityCsv", () => {
  it("parses a well-formed row with a contact", () => {
    const csv = `${HEADER}\nSEED-GC-1,Seed General Contractor LLC,general_contractor,120,active,Jane Doe,jane@example.com,true\n`;
    const result = parseEntityCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.entities).toEqual([
      {
        entityCode: "SEED-GC-1",
        name: "Seed General Contractor LLC",
        type: "general_contractor",
        workerCount: 120,
        projectName: null,
        projectType: null,
        status: "active",
        contacts: [
          { name: "Jane Doe", role: null, email: "jane@example.com", phone: null, isPrimary: true },
        ],
      },
    ]);
  });

  it("merges two rows sharing the same entity_code into one entity with two contacts", () => {
    const csv =
      `${HEADER}\n` +
      "SEED-GC-1,Seed General Contractor LLC,general_contractor,,active,Jane Doe,jane@example.com,true\n" +
      "SEED-GC-1,Seed General Contractor LLC,general_contractor,,active,John Smith,john@example.com,false\n";
    const result = parseEntityCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0]!.contacts).toHaveLength(2);
    expect(result.entities[0]!.contacts.map((c) => c.name)).toEqual(["Jane Doe", "John Smith"]);
  });

  it("a later row's entity-level fields override an earlier row for the same entity_code", () => {
    const csv =
      `${HEADER}\n` +
      "SEED-GC-1,Old Name,general_contractor,,active,,,\n" +
      "SEED-GC-1,Corrected Name,general_contractor,,active,,,\n";
    const result = parseEntityCsv(csv);
    expect(result.entities[0]!.name).toBe("Corrected Name");
  });

  it("rejects a file missing a required column", () => {
    const result = parseEntityCsv("entity_name,type\nFoo,general_contractor\n");
    expect(result.entities).toEqual([]);
    expect(result.errors).toEqual([{ row: 1, message: "Missing required column(s): entity_code." }]);
  });

  it("flags a row missing entity_code and skips it", () => {
    const csv = `${HEADER}\n,Some Entity,general_contractor,,active,,,\n`;
    const result = parseEntityCsv(csv);
    expect(result.entities).toEqual([]);
    expect(result.errors).toEqual([{ row: 2, message: "entity_code is required." }]);
  });

  it("flags an invalid type value", () => {
    const csv = `${HEADER}\nX-1,Some Entity,not_a_real_type,,active,,,\n`;
    const result = parseEntityCsv(csv);
    expect(result.entities).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain('type "not_a_real_type" is not one of');
  });

  it("flags a non-numeric worker_count", () => {
    const csv = `${HEADER}\nX-1,Some Entity,general_contractor,many,active,,,\n`;
    const result = parseEntityCsv(csv);
    expect(result.entities).toEqual([]);
    expect(result.errors[0]!.message).toBe('worker_count "many" is not a whole number.');
  });

  it("flags an invalid status value", () => {
    const csv = `${HEADER}\nX-1,Some Entity,general_contractor,,archived,,,\n`;
    const result = parseEntityCsv(csv);
    expect(result.entities).toEqual([]);
    expect(result.errors[0]!.message).toContain('status "archived" is not one of');
  });

  it("flags a contact email with no contact name", () => {
    const csv = `${HEADER}\nX-1,Some Entity,general_contractor,,active,,jane@example.com,\n`;
    const result = parseEntityCsv(csv);
    expect(result.errors).toEqual([{ row: 2, message: "contact_name is required when a contact is given." }]);
  });

  it("defaults status to active and worker_count to null when omitted", () => {
    const csv = `${HEADER}\nX-1,Some Entity,general_contractor,,,,,\n`;
    const result = parseEntityCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.entities[0]!.status).toBe("active");
    expect(result.entities[0]!.workerCount).toBeNull();
  });

  it("rejects an empty file", () => {
    expect(parseEntityCsv("").errors).toEqual([{ row: 1, message: "The file is empty." }]);
  });
});
