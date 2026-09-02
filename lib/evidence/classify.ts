import { documentClassSchema, type DocumentClass } from "@/lib/db/evidence";

export const DOCUMENT_CLASSES = documentClassSchema.options;

/**
 * Document classifier (this prompt: "rules first, not AI") — filename and
 * mime-type heuristics proposing a document_class. Deterministic keyword
 * matching, the same "AI extracts, deterministic code decides" split
 * CONTEXT.md rule 2 applies everywhere else in this app; an assessor can
 * always override the proposal (lib/evidence/actions.ts never treats this
 * as final). Order matters — rules are checked top to bottom and the
 * first match wins, so more specific keyword combinations are listed
 * before the generic mime-type fallback at the bottom.
 */
interface ClassificationRule {
  documentClass: DocumentClass;
  test: (lowerFilename: string, lowerMimeType: string) => boolean;
}

const RULES: ClassificationRule[] = [
  { documentClass: "wps_report", test: (n) => /\bwps\b/.test(n) || n.includes("wage protection") },
  { documentClass: "payroll_register", test: (n) => n.includes("payroll") },
  { documentClass: "employment_contract", test: (n) => n.includes("employment") && n.includes("contract") },
  {
    documentClass: "recruitment_agreement",
    test: (n) => n.includes("recruitment") && (n.includes("agreement") || n.includes("contract")),
  },
  { documentClass: "passport_register", test: (n) => n.includes("passport") },
  { documentClass: "insurance_schedule", test: (n) => n.includes("insurance") },
  {
    documentClass: "accommodation_contract",
    test: (n) => n.includes("accommodation") && (n.includes("contract") || n.includes("lease") || n.includes("tenancy")),
  },
  {
    documentClass: "civil_defence_certificate",
    test: (n) => n.includes("civil defence") || n.includes("civil defense") || n.includes("fire safety certificate"),
  },
  { documentClass: "occupancy_schedule", test: (n) => n.includes("occupancy") },
  {
    documentClass: "approved_drawing",
    test: (n) => n.includes("drawing") || n.includes("floor plan") || n.includes("floorplan"),
  },
  { documentClass: "induction_register", test: (n) => n.includes("induction") },
  {
    documentClass: "worker_register",
    test: (n) => n.includes("worker register") || n.includes("employee register") || (n.includes("worker") && n.includes("register")),
  },
  { documentClass: "vehicle_registration", test: (n) => n.includes("vehicle") || n.includes("mulkiya") },
  { documentClass: "photo", test: (_n, m) => m.startsWith("image/") },
];

export interface ClassifyInput {
  filename: string;
  mimeType: string;
}

/** Returns null when nothing matches — the assessor picks a class manually rather than one being guessed. */
export function classifyDocument(input: ClassifyInput): DocumentClass | null {
  // Filenames typically use "_"/"-"/"." as word separators rather than
  // spaces ("Civil_Defence_Certificate.pdf") — normalized to spaces so
  // multi-word keyword phrases ("civil defence", "worker register") and
  // \b-bounded ones ("wps") match regardless of the separator used.
  const lowerFilename = input.filename.toLowerCase().replace(/[_\-.]+/g, " ");
  const lowerMimeType = input.mimeType.toLowerCase();
  for (const rule of RULES) {
    if (rule.test(lowerFilename, lowerMimeType)) {
      return rule.documentClass;
    }
  }
  return null;
}
