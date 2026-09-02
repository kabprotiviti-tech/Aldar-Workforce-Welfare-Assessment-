import { PortfolioView } from "@/components/app/portfolio-view";

export default async function AccommodationPage({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string; owner?: string; overdue?: string }>;
}) {
  return (
    <PortfolioView
      module="accommodation"
      title="Accommodation"
      description="95 facilities per cycle, physical inspection, 12 assessment areas."
      searchParams={await searchParams}
    />
  );
}
