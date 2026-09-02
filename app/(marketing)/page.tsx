import { Hero } from "@/components/marketing/hero";
import { Problem } from "@/components/marketing/problem";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { Boundary } from "@/components/marketing/boundary";
import { ReportSample } from "@/components/marketing/report-sample";
import { WhoItsFor } from "@/components/marketing/who-its-for";
import { Contact } from "@/components/marketing/contact";

export default function MarketingPage() {
  return (
    <>
      <Hero />
      <Problem />
      <HowItWorks />
      <Boundary />
      <ReportSample />
      <WhoItsFor />
      <Contact />
    </>
  );
}
