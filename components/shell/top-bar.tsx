"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { getBreadcrumb } from "@/lib/shell-nav";
import { signOut } from "@/lib/auth/actions";

export interface CycleOption {
  id: string;
  name: string;
}

export interface TopBarProps {
  cycles: CycleOption[];
  onOpenNav: () => void;
}

export function TopBar({ cycles, onOpenNav }: TopBarProps) {
  const pathname = usePathname();
  const breadcrumb = getBreadcrumb(pathname);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isTyping = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";
      if (event.key === "/" && !isTyping) {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <header className="flex items-center gap-3 border-b border-ds-line bg-ds-surface px-4 py-3 sm:px-6">
      <button
        type="button"
        onClick={onOpenNav}
        aria-label="Open navigation"
        className="ds-focus-ring rounded-ds-control border border-ds-line p-2 text-ds-ink-2 md:hidden"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>

      <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
        <ol className="flex items-center gap-1.5 truncate text-sm">
          {breadcrumb.map((label, index) => (
            <li key={label} className="flex items-center gap-1.5 truncate">
              {index > 0 && <span className="text-ds-ink-2">/</span>}
              <span className={index === breadcrumb.length - 1 ? "font-medium text-ds-ink" : "text-ds-ink-2"}>
                {label}
              </span>
            </li>
          ))}
        </ol>
      </nav>

      <label className="relative hidden sm:block">
        <span className="sr-only">Search</span>
        <input
          ref={searchInputRef}
          type="search"
          placeholder="Search — press /"
          className="ds-focus-ring w-40 rounded-ds-control border border-ds-line bg-ds-surface-2 px-3 py-1.5 text-sm text-ds-ink placeholder:text-ds-ink-2 lg:w-64"
        />
      </label>

      <label className="hidden md:block">
        <span className="sr-only">Cycle</span>
        <select
          disabled={cycles.length === 0}
          defaultValue={cycles[0]?.id}
          className="ds-focus-ring rounded-ds-control border border-ds-line bg-ds-surface px-2.5 py-1.5 text-sm text-ds-ink disabled:opacity-50"
        >
          {cycles.length === 0 ? (
            <option>No cycles yet</option>
          ) : (
            cycles.map((cycle) => (
              <option key={cycle.id} value={cycle.id}>
                {cycle.name}
              </option>
            ))
          )}
        </select>
      </label>

      <form action={signOut}>
        <button type="submit" className="ds-focus-ring rounded-ds-control px-2 py-1.5 text-sm text-ds-ink-2 hover:text-ds-ink">
          Sign out
        </button>
      </form>
    </header>
  );
}
