export type NavLeaf = { label: string; href: string };
export type NavSection = { label: string; href?: string; children?: NavLeaf[] };

export const NAV_SECTIONS: NavSection[] = [
  { label: "Overview", href: "/app" },
  { label: "Entities", href: "/app/entities" },
  { label: "Cycles", href: "/app/cycles" },
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

/**
 * Section/leaf labels leading to the given path, for the top bar
 * breadcrumb. Falls back to the longest nav href that's a prefix of the
 * current path (e.g. /app/entities/<id> -> "Entities") so a detail page
 * one level below a list page still gets a sensible breadcrumb, rather
 * than every unmatched route defaulting to "Overview".
 */
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

  let best: { label: string; href: string } | undefined;
  for (const section of NAV_SECTIONS) {
    for (const candidate of [section, ...(section.children ?? [])]) {
      if (candidate.href && pathname.startsWith(`${candidate.href}/`)) {
        if (!best || candidate.href.length > best.href.length) {
          best = { label: candidate.label, href: candidate.href };
        }
      }
    }
  }
  return best ? [best.label] : ["Overview"];
}
