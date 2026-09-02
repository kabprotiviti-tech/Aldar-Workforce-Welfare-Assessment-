import type { DocumentClass } from "@/lib/db/evidence";
import type { EvidenceReviewStatus } from "@/lib/db/evidence";

export const DOCUMENT_CLASS_LABELS: Record<DocumentClass, string> = {
  wps_report: "WPS report",
  payroll_register: "Payroll register",
  employment_contract: "Employment contract",
  recruitment_agreement: "Recruitment agreement",
  passport_register: "Passport register",
  insurance_schedule: "Insurance schedule",
  accommodation_contract: "Accommodation contract",
  civil_defence_certificate: "Civil defence certificate",
  occupancy_schedule: "Occupancy schedule",
  approved_drawing: "Approved drawing",
  worker_register: "Worker register",
  induction_register: "Induction register",
  vehicle_registration: "Vehicle registration",
  photo: "Photo",
};

export const REVIEW_STATUS_LABELS: Record<EvidenceReviewStatus, string> = {
  outstanding: "Outstanding",
  received: "Received",
  in_review: "In review",
  reviewed: "Reviewed",
  gap_flagged: "Gap flagged",
};
