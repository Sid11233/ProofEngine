import type { IconName } from "@/components/ui/icons";

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Main",
    items: [
      { href: "/app/dashboard", label: "Dashboard", icon: "home" },
      { href: "/app/requests", label: "Requests", icon: "mail" },
      { href: "/app/clients", label: "Clients", icon: "users" },
      { href: "/app/onboarding", label: "Client onboarding", icon: "chat" },
      { href: "/app/projects", label: "Projects", icon: "grid" },
      { href: "/app/case-studies", label: "Case studies", icon: "file" },
      { href: "/app/demos", label: "Demos", icon: "play" },
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
    ],
  },
];

/** Settings opens these. (Wall of proof, Social links and Team live under /app/settings too but belong to the groups above.) */
export const SETTINGS_ITEMS: NavItem[] = [
  { href: "/app/settings/notifications", label: "Notifications", icon: "bell" },
  { href: "/app/settings/privacy", label: "Privacy", icon: "lock" },
  { href: "/app/settings/motion", label: "Motion", icon: "play" },
  { href: "/app/settings/security", label: "Security", icon: "shield" },
];

export const ADMIN_ITEMS: NavItem[] = [
  { href: "/app/admin/takedowns", label: "Takedowns", icon: "shield" },
  { href: "/app/admin/demo-reports", label: "Demo reports", icon: "shield" },
];

/** The five places on the phone's bottom bar; everything else is under More. */
export const TAB_ITEMS: NavItem[] = NAV_GROUPS[0].items;

export const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);
export const settingsActive = (pathname: string) => SETTINGS_ITEMS.some((item) => isActive(pathname, item.href));
