import { HeroTrace } from "@/components/marketing/hero-trace";

export function Hero() {
  return (
    <section className="border-b border-hairline px-6 py-16 sm:py-24">
      <div className="mx-auto max-w-5xl">
        <h1 className="max-w-2xl text-3xl font-semibold leading-tight text-ink sm:text-4xl">
          Every finding traced back to its evidence.
        </h1>
        <p className="mt-5 max-w-xl text-base leading-relaxed text-ink-secondary sm:text-lg">
          WWAP runs employment practices, onboarding, and accommodation assessments across a
          supply chain, and keeps every rating attached to the document, the rule, and the
          person who confirmed it.
        </p>
        <div className="mt-12">
          <HeroTrace />
        </div>
        <div className="mt-10 flex flex-wrap items-center gap-4">
          <a
            href="#contact"
            className="rounded-control bg-ink px-4 py-2 text-sm font-medium text-bg transition-colors duration-micro ease-instrument hover:opacity-90"
          >
            Request a walkthrough
          </a>
          <a
            href="#report"
            className="rounded-control border border-hairline px-4 py-2 text-sm font-medium text-ink transition-colors duration-micro ease-instrument hover:border-ink"
          >
            See a sample report
          </a>
        </div>
      </div>
    </section>
  );
}
