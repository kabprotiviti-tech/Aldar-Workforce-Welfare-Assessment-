export type NavLeaf = { label: string; href: string };
export type NavSection = { label: string; href?: string; children?: NavLeaf[] };

export const NAV_SECTIONS: NavSection[] = [
  { label: "Overview", href: "/app" },
  {
    label: "Assessment Programmes",
    children: [
      { label: "Employment Practices", href: "/app/programmes/employment-practices" },
      { label: "Onboarding", href: "/app/programmes/onboarding" },
      { label: "Accommodation", href: "/app/programmes/accommodation" },
    ],
  },
  { label: "Evidence Centre", href: "/app/evidence" },
  { label: "Findings & Actions", href: "/app/findings" },
  { label: "Monitoring", href: "/app/monitoring" },
  { label: "Reports", href: "/app/reports" },
  { label: "Settings", href: "/app/settings" },
];

/** Section/leaf labels leading to the given path, for the top bar breadcrumb. */
export function getBreadcrumb(pathname: string): string[] {
  for (const section of NAV_SECTIONS) {
    if (section.href === pathname) {
      return [section.label];
    }
    for (const child of section.children ?? []) {
      if (child.href === pathname) {
        return [section.label, child.label];
      }
    }
  }
  return ["Overview"];
}
