import { PortfolioView } from "@/components/app/portfolio-view";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string; owner?: string; overdue?: string }>;
}) {
  return (
    <PortfolioView
      module="onboarding"
      title="Onboarding"
      description="17 entities per cycle: desktop document review, then office visit, then a final compliance report."
      searchParams={await searchParams}
    />
  );
}
