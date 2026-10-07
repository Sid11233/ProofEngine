import type { IconName } from "@/components/ui/icons";

// The app's navigation, in one place. Routes, permissions and active states are unchanged from the old top bar;
// only the grouping changed.

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  /** Items shown under this one (Settings). */
  children?: Array<{ href: string; label: string }>;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const SETTINGS_CHILDREN = [
  { href: "/app/settings/notifications", label: "Notifications" },
  { href: "/app/settings/privacy", label: "Privacy" },
  { href: "/app/settings/motion", label: "Motion" },
  { href: "/app/settings/security", label: "Security" },
];

export function buildNav({ platformAdmin }: { platformAdmin: boolean }): NavGroup[] {
  return [
    {
      label: "Main",
      items: [
        { href: "/app/dashboard", label: "Dashboard", icon: "home" },
        { href: "/app/requests", label: "Requests", icon: "mail" },
        { href: "/app/case-studies", label: "Case studies", icon: "file" },
        { href: "/app/referrals", label: "Referrals", icon: "share" },
      ],
    },
    {
      label: "Grow",
      items: [
        { href: "/app/finder", label: "Communities", icon: "compass" },
        { href: "/app/settings/wall", label: "Wall of proof", icon: "grid" },
        { href: "/app/settings/social", label: "Social links", icon: "chat" },
      ],
    },
    {
      label: "Workspace",
      items: [
        { href: "/app/settings/team", label: "Team", icon: "users" },
        { href: "/app/billing", label: "Billing", icon: "card" },
        { href: SETTINGS_CHILDREN[0].href, label: "Settings", icon: "gear", children: SETTINGS_CHILDREN },
        ...(platformAdmin ? [{ href: "/app/admin/takedowns", label: "Takedowns", icon: "shield" as const }] : []),
      ],
    },
  ];
}

/** The four places the phone's bottom bar shows besides "More". */
export const TAB_HREFS = ["/app/dashboard", "/app/requests", "/app/case-studies", "/app/referrals"] as const;

export const isActivePath = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

/** Settings is active when any of its sub-pages is. */
export const isItemActive = (pathname: string, item: NavItem) =>
  item.children ? item.children.some((child) => isActivePath(pathname, child.href)) : isActivePath(pathname, item.href);

export const SIDEBAR_COOKIE = "pe_sidebar";
export const parseSidebar = (value: string | undefined | null): "open" | "collapsed" => (value === "collapsed" ? "collapsed" : "open");
