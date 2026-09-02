import { ThemeToggle } from "@/components/theme/theme-toggle";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-bg">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-surface focus:px-3 focus:py-2 focus:text-sm"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-hairline bg-surface px-6 py-4">
        <span className="text-sm font-semibold tracking-[-0.02em] text-ink">WWAP</span>
        <ThemeToggle />
      </header>
      <main id="main">{children}</main>
    </div>
  );
}
