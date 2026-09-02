"use client";

import { useState } from "react";
import { Nav } from "@/components/shell/nav";
import { TopBar, type CycleOption } from "@/components/shell/top-bar";
import { Drawer } from "@/components/ds/drawer";
import { ToastProvider } from "@/components/ds/toast";

export function AppShell({
  cycles,
  children,
}: {
  cycles: CycleOption[];
  children: React.ReactNode;
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <ToastProvider>
      <div className="flex min-h-screen bg-ds-bg">
        <aside className="hidden w-60 shrink-0 border-r border-ds-line bg-ds-surface md:block">
          <div className="px-4 py-4">
            <span className="text-sm font-semibold text-ds-ink">WWAP</span>
          </div>
          <Nav />
        </aside>

        <Drawer open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} title="Navigation">
          <Nav onNavigate={() => setMobileNavOpen(false)} />
        </Drawer>

        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar cycles={cycles} onOpenNav={() => setMobileNavOpen(true)} />
          <main className="flex-1 p-4 sm:p-6">{children}</main>
        </div>
      </div>
    </ToastProvider>
  );
}
