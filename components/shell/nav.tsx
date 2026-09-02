"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_SECTIONS } from "@/lib/shell-nav";

export function Nav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1 p-3" aria-label="Primary">
      {NAV_SECTIONS.map((section) => {
        if (!section.children) {
          const active = pathname === section.href;
          return (
            <Link
              key={section.label}
              href={section.href ?? "#"}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={`ds-focus-ring rounded-ds-control px-3 py-2 text-sm font-medium transition-colors duration-150 ${
                active ? "bg-ds-accent-soft text-ds-accent-2" : "text-ds-ink-2 hover:bg-ds-surface-2 hover:text-ds-ink"
              }`}
            >
              {section.label}
            </Link>
          );
        }

        return (
          <div key={section.label} className="mt-2">
            <p className="px-3 text-xs font-medium text-ds-ink-2">{section.label}</p>
            <div className="mt-1 flex flex-col gap-1">
              {section.children.map((child) => {
                const active = pathname === child.href;
                return (
                  <Link
                    key={child.href}
                    href={child.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={`ds-focus-ring rounded-ds-control px-3 py-2 text-sm font-medium transition-colors duration-150 ${
                      active
                        ? "bg-ds-accent-soft text-ds-accent-2"
                        : "text-ds-ink-2 hover:bg-ds-surface-2 hover:text-ds-ink"
                    }`}
                  >
                    {child.label}
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );
}
