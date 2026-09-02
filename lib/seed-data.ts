/**
 * Fixed identifiers for the one-organisation/four-user/three-entity/
 * two-facility/one-cycle seed fixture. Fixed (not randomly generated) so
 * that re-running the seed script upserts the same rows instead of
 * creating duplicates — see scripts/seed.ts and docs/decisions.md.
 */

export const SEED_ORGANISATION = {
  id: "00000000-0000-0000-0000-000000000001",
  name: "WWAP Seed Organisation",
};

export const SEED_USERS = [
  {
    id: "00000000-0000-0000-0000-0000000000a1",
    email: "admin@wwap.seed",
    full_name: "Seed Admin",
    role: "admin" as const,
  },
  {
    id: "00000000-0000-0000-0000-0000000000a2",
    email: "assessor@wwap.seed",
    full_name: "Seed Assessor",
    role: "assessor" as const,
  },
  {
    id: "00000000-0000-0000-0000-0000000000a3",
    email: "qa_reviewer@wwap.seed",
    full_name: "Seed QA Reviewer",
    role: "qa_reviewer" as const,
  },
  {
    id: "00000000-0000-0000-0000-0000000000a4",
    email: "client_viewer@wwap.seed",
    full_name: "Seed Client Viewer",
    role: "client_viewer" as const,
    // Set below once SEED_ENTITIES exists, to avoid a forward reference.
    entity_id: "00000000-0000-0000-0000-000000000101",
  },
];

export const SEED_PASSWORD = "wwap-seed-password-change-me";

export const SEED_ENTITIES = [
  {
    id: "00000000-0000-0000-0000-000000000101",
    name: "Seed General Contractor LLC",
    entity_code: "SEED-GC-1",
    type: "general_contractor" as const,
  },
  {
    id: "00000000-0000-0000-0000-000000000102",
    name: "Seed Facilities Management LLC",
    entity_code: "SEED-FM-1",
    type: "facilities_management" as const,
  },
  {
    id: "00000000-0000-0000-0000-000000000103",
    name: "Seed Subcontractor LLC",
    entity_code: "SEED-SUB-1",
    type: "subcontractor" as const,
  },
];

export const SEED_FACILITIES = [
  {
    id: "00000000-0000-0000-0000-000000000201",
    entity_id: SEED_ENTITIES[1]!.id,
    name: "Seed Labour Accommodation A",
    facility_code: "SEED-FAC-1",
  },
  {
    id: "00000000-0000-0000-0000-000000000202",
    entity_id: SEED_ENTITIES[1]!.id,
    name: "Seed Labour Accommodation B",
    facility_code: "SEED-FAC-2",
  },
];

export const SEED_CYCLE = {
  id: "00000000-0000-0000-0000-000000000301",
  year: 2026,
  name: "2026 Cycle 1",
};
