import { getPhotoField, type PhotoClass } from "@/lib/vision/classes";

/**
 * Which photograph readings are allowed to become facts, and under which
 * fact key (this prompt: "a photo-derived date becomes a fact only after
 * assessor confirmation, then feeds the rule engine like any other
 * fact").
 *
 * "Like any other fact" is meant literally: a confirmed reading is
 * written to extracted_facts and read back through
 * fact_ledger_confirmed, the same table and the same view the document
 * extraction service uses. The rule engine cannot tell the difference and
 * does not need to.
 *
 * The list is deliberately short. Most of what a photograph shows —
 * mould, obstruction, waste, cleanliness — is an observation for an
 * assessor to weigh, not a value for a rule to compute with. Only a
 * reading that is a piece of *printed text* is eligible, because only
 * printed text is something the camera recorded rather than something
 * the model judged.
 */

export type DerivedValueType = "date" | "text";

export interface DerivedFactDefinition {
  photoClass: PhotoClass;
  fieldKey: string;
  valueType: DerivedValueType;
  /**
   * The fact keys this reading may be recorded under. One entry means a
   * fixed key. Several means the assessor chooses, because the same
   * photograph — a certificate on a wall — could be a civil defence
   * certificate or something else entirely, and that is a person's
   * reading of the document, not the model's.
   */
  factKeyChoices: readonly [string, ...string[]];
  /** What the reading is called where the assessor confirms it. */
  label: string;
}

export const DERIVED_FACT_DEFINITIONS: readonly DerivedFactDefinition[] = [
  {
    photoClass: "fire_extinguisher",
    fieldKey: "service_date_text",
    valueType: "date",
    factKeyChoices: ["fire_extinguisher_service_date"],
    label: "Last service date",
  },
  {
    photoClass: "fire_extinguisher",
    fieldKey: "expiry_date_text",
    valueType: "date",
    factKeyChoices: ["fire_extinguisher_expiry_date"],
    label: "Next service due / expiry date",
  },
  {
    photoClass: "notice_board",
    fieldKey: "grievance_number_legible",
    valueType: "text",
    factKeyChoices: ["grievance_contact_number"],
    label: "Grievance contact number",
  },
  {
    photoClass: "certificate_document",
    fieldKey: "reference_number",
    valueType: "text",
    factKeyChoices: ["photo_certificate_reference"],
    label: "Certificate reference number",
  },
  {
    photoClass: "certificate_document",
    fieldKey: "expiry_date_text",
    valueType: "date",
    // The assessor says what the certificate is. A photograph of a
    // document on a wall should not silently become the authoritative
    // civil defence expiry that a rule computes with unless a person
    // looked at it and said that is what it is.
    factKeyChoices: ["photo_certificate_expiry_date", "civil_defence_expiry_date", "vehicle_registration_expiry_date"],
    label: "Certificate expiry date",
  },
  {
    photoClass: "vehicle",
    fieldKey: "registration_plate_text",
    valueType: "text",
    factKeyChoices: ["vehicle_registration_plate"],
    label: "Registration plate",
  },
];

/**
 * Every fact key a photograph may ever produce. Seeded into
 * public.photo_derived_fact_keys by 0026_photo_analysis.sql, where a
 * trigger rejects any photo-sourced fact whose key is not in it — so the
 * guarantee holds against every code path, not only this one.
 */
export const PHOTO_DERIVED_FACT_KEYS: readonly string[] = [
  ...new Set(DERIVED_FACT_DEFINITIONS.flatMap((definition) => definition.factKeyChoices)),
].sort();

export function derivedFactsFor(photoClass: string): DerivedFactDefinition[] {
  return DERIVED_FACT_DEFINITIONS.filter((definition) => definition.photoClass === photoClass);
}

export function derivedFactFor(photoClass: string, fieldKey: string): DerivedFactDefinition | null {
  return DERIVED_FACT_DEFINITIONS.find((d) => d.photoClass === photoClass && d.fieldKey === fieldKey) ?? null;
}

/**
 * Guards the table above against itself: a derived fact may only be
 * declared for a field that exists and is a verbatim text reading. If
 * someone later points a derived fact at, say, room_general's bed count,
 * this fails at import time rather than quietly letting a count in frame
 * become a value a rule computes with.
 */
for (const definition of DERIVED_FACT_DEFINITIONS) {
  const field = getPhotoField(definition.photoClass, definition.fieldKey);
  if (!field) {
    throw new Error(`derived-facts: ${definition.photoClass}.${definition.fieldKey} is not a declared field`);
  }
  if (field.kind !== "text") {
    throw new Error(`derived-facts: ${definition.photoClass}.${definition.fieldKey} is ${field.kind}, and only a verbatim text reading may become a fact`);
  }
}
