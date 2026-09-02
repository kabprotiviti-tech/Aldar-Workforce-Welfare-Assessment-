import type { ComplianceRating } from "@/lib/rules/constants";

const COLOR: Record<ComplianceRating, string> = {
  Compliant: "text-compliant",
  Partial: "text-partial",
  "Not Compliant": "text-not-compliant",
  "Not Applicable": "text-not-applicable",
};

export function RatingBadge({ rating }: { rating: ComplianceRating }) {
  return <span className={`text-sm font-medium ${COLOR[rating]}`}>{rating}</span>;
}
