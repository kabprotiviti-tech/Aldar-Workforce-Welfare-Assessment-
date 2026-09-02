import { PortfolioView } from "@/components/app/portfolio-view";

export default async function EmploymentPracticesPage({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string; owner?: string; overdue?: string }>;
}) {
  return (
    <PortfolioView
      module="employment_practices"
      title="Employment Practices"
      description="73 entities per cycle, office visit, 23 requirements."
      searchParams={await searchParams}
    />
  );
}
