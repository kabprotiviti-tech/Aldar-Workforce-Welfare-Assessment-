import Link from "next/link";
import { ThemeToggle } from "@/components/theme/theme-toggle";

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-bg">
      <header className="flex items-center justify-between border-b border-hairline bg-surface px-6 py-3">
        <Link href="/" className="text-sm font-semibold tracking-[-0.01em] text-ink">
          WWAP
        </Link>
        <ThemeToggle />
      </header>
      <main>{children}</main>
    </div>
  );
}
