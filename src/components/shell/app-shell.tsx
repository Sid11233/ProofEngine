"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { m } from "motion/react";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Avatar } from "@/components/ui/avatar";

import { Icon } from "@/components/ui/icons";
import { Dialog } from "@/components/motion/dialog";
import { spring } from "@/lib/motion/springs";
import { useReducedMotion } from "@/lib/motion/useReducedMotion";
import { BrandLogo } from "./brand-logo";
import { MenuButton } from "./menu";
import { ADMIN_ITEM, isActive, NAV_GROUPS, SETTINGS_ITEMS, settingsActive, TAB_ITEMS, type NavItem } from "./nav-config";

/** The workspace's orange circle with its first letter (the pill at the top of the sidebar). */
function WorkspaceBadge({ name, size }: { name: string; size: number }) {
  return (
    <span aria-hidden="true" style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }} className="inline-flex shrink-0 items-center justify-center rounded-full bg-[var(--signal)] font-semibold text-white">
      {(name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}
export interface ShellNotice {
  id: string;
  tone: "warning" | "danger";
  text: string;
  actionHref: string;
  actionLabel: string;
}

interface Props {
  workspace: { name: string; plan: string };
  user: { email: string };
  isPlatformAdmin: boolean;
  notice: ShellNotice | null;
  initialCollapsed: boolean;
  /** Server-rendered pieces that need the server (a form with a server action) or their own listeners. */
  installSlot: ReactNode;
  signOutSlot: ReactNode;
  footer: ReactNode;
  children: ReactNode;
}

const SIDEBAR_COOKIE = "pe_sidebar";
const EXPANDED = 240;
const COLLAPSED = 72;

const linkBase = "relative flex min-h-10 items-center gap-3 rounded-control px-3 text-sm outline-none no-underline hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--signal-strong)]";

/** One sidebar link. The active page has a soft orange pill (shared between items, G-05), an orange icon and medium weight. */
function SideLink({ item, active, collapsed, pillId }: { item: NavItem; active: boolean; collapsed: boolean; pillId: string }) {
  return (
    <Link href={item.href} aria-current={active ? "page" : undefined} title={collapsed ? item.label : undefined} className={`${linkBase} ${active ? "font-medium" : "text-foreground/80 hover:bg-black/[0.04]"}`}>
      {active && <m.span layoutId={pillId} transition={spring("default")} className="absolute inset-0 -z-0 rounded-control bg-tint" />}
      <Icon name={item.icon} className={`relative ${active ? "text-[var(--signal-strong)]" : "text-muted"}`} />
      <span className={`relative ${collapsed ? "sr-only" : ""}`}>{item.label}</span>
    </Link>
  );
}

function Sidebar({ collapsed, onToggle, workspace, isPlatformAdmin }: { collapsed: boolean; onToggle: () => void; workspace: Props["workspace"]; isPlatformAdmin: boolean }) {
  const pathname = usePathname();
  const reduced = useReducedMotion();
  const inSettings = settingsActive(pathname);
  const [settingsOpen, setSettingsOpen] = useState(inSettings);
  const open = settingsOpen || inSettings;
  const groups = NAV_GROUPS.map((group) => (group.label === "Workspace" && isPlatformAdmin ? { ...group, items: [...group.items, ADMIN_ITEM] } : group));

  return (
    <m.aside
      data-anim="G-04"
      aria-label="Sidebar"
      initial={false}
      animate={{ width: collapsed ? COLLAPSED : EXPANDED }}
      transition={reduced ? { duration: 0 } : spring("snappy")}
      className="sticky top-0 hidden h-dvh shrink-0 flex-col overflow-hidden border-r border-line bg-surface md:flex"
    >
      <div className={`flex h-16 shrink-0 items-center ${collapsed ? "justify-center" : "justify-between px-5"}`}>
        <Link href="/app/dashboard" aria-label="Attract Studio, dashboard" className="no-underline hover:no-underline">
          <BrandLogo iconOnly={collapsed} />
        </Link>
        {!collapsed && (
          <button type="button" onClick={onToggle} aria-label="Collapse sidebar" aria-keyshortcuts="Control+B Meta+B" className="inline-flex size-9 items-center justify-center rounded-control text-muted outline-none hover:bg-black/[0.04] focus-visible:outline-2 focus-visible:outline-[var(--signal-strong)]">
            <Icon name="sidebar" />
          </button>
        )}
      </div>

      <div className="px-3 pb-2">
        <MenuButton
          label={`Workspace: ${workspace.name}`}
          align="left"
          panelClassName="w-64"
          wrapperClassName="relative w-full"
          buttonClassName={collapsed ? "size-11 justify-center rounded-full" : "w-full rounded-full"}
          button={
            collapsed ? <WorkspaceBadge name={workspace.name} size={36} /> : (
              <span className="flex w-full items-center gap-3 rounded-full border border-line bg-surface py-1.5 pl-1.5 pr-3 text-left shadow-sm">
                <WorkspaceBadge name={workspace.name} size={32} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{workspace.name}</span>
                <Icon name="chevronDown" className="text-muted" />
              </span>
            )
          }
        >
          {(close) => (
            <div role="none" className="space-y-1 text-sm">
              <p className="px-2 pt-1 text-xs font-medium uppercase tracking-wider text-muted">Workspace</p>
              <div role="menuitem" tabIndex={-1} className="flex items-center gap-3 rounded-control bg-tint px-2 py-2">
                <WorkspaceBadge name={workspace.name} size={28} />
                <span className="min-w-0 flex-1"><span className="block truncate font-medium">{workspace.name}</span><span className="block text-xs capitalize text-muted">{workspace.plan} plan</span></span>
                <Icon name="check" className="text-[var(--signal-strong)]" />
              </div>
              <Link role="menuitem" href="/app/billing" onClick={close} className="flex min-h-10 items-center gap-3 rounded-control px-2 no-underline hover:bg-black/[0.04] hover:no-underline"><Icon name="card" className="text-muted" />Manage plan</Link>
            </div>
          )}
        </MenuButton>
      </div>

      <nav data-anim="G-05" aria-label="Main" className="min-h-0 flex-1 space-y-5 overflow-y-auto px-3 pb-4 pt-2">
        {groups.map((group) => (
          <div key={group.label}>
            <p className={`px-3 pb-1 text-xs font-medium uppercase tracking-wider text-muted ${collapsed ? "sr-only" : ""}`}>{group.label}</p>
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.href}><SideLink item={item} active={isActive(pathname, item.href)} collapsed={collapsed} pillId="sidebar-pill" /></li>
              ))}
              {group.label === "Workspace" && (
                <li>
                  {collapsed ? (
                    <SideLink item={{ href: SETTINGS_ITEMS[0].href, label: "Settings", icon: "gear" }} active={inSettings} collapsed pillId="sidebar-pill" />
                  ) : (
                    <>
                      <button type="button" aria-expanded={open} aria-controls="settings-sub" onClick={() => setSettingsOpen(!open)} className={`${linkBase} w-full text-left ${inSettings ? "font-medium" : "text-foreground/80 hover:bg-black/[0.04]"}`}>
                        <Icon name="gear" className={inSettings ? "text-[var(--signal-strong)]" : "text-muted"} />
                        <span className="flex-1">Settings</span>
                        <Icon name="chevronRight" className={`text-muted transition-transform ${open ? "rotate-90" : ""}`} />
                      </button>
                      {open && (
                        <ul id="settings-sub" className="ml-4 mt-0.5 space-y-0.5 border-l border-line pl-2">
                          {SETTINGS_ITEMS.map((item) => (
                            <li key={item.href}><SideLink item={item} active={isActive(pathname, item.href)} collapsed={false} pillId="sidebar-pill" /></li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </li>
              )}
            </ul>
          </div>
        ))}
      </nav>

      {collapsed && (
        <div className="flex justify-center pb-4">
          <button type="button" onClick={onToggle} aria-label="Expand sidebar" aria-keyshortcuts="Control+B Meta+B" className="inline-flex size-10 items-center justify-center rounded-control text-muted outline-none hover:bg-black/[0.04] focus-visible:outline-2 focus-visible:outline-[var(--signal-strong)]">
            <Icon name="sidebar" />
          </button>
        </div>
      )}
    </m.aside>
  );
}

function TopBar({ email, name, installSlot, signOutSlot }: { email: string; name: string; installSlot: ReactNode; signOutSlot: ReactNode }) {
  return (
    <div className="flex h-16 items-center justify-between gap-3 px-4 md:justify-end md:px-8">
      <div className="flex min-w-0 items-center gap-3 md:hidden">
        <Link href="/app/dashboard" aria-label="Attract Studio, dashboard" className="shrink-0 no-underline hover:no-underline"><BrandLogo iconOnly /></Link>
        <span className="truncate text-sm font-medium">{name}</span>
      </div>
      <div className="flex items-center gap-2">
        <MenuButton
          label="Notifications"
          button={<span className="inline-flex size-10 items-center justify-center rounded-full border border-line bg-surface"><Icon name="bell" size={18} /></span>}
        >
          {(close) => (
            <div role="none" className="space-y-2 p-2 text-sm">
              <p className="font-medium">Notifications</p>
              <p className="text-muted">You are all caught up. Reminders and approvals show up here and as push notifications.</p>
              <Link role="menuitem" href="/app/settings/notifications" onClick={close} className="inline-flex min-h-10 items-center font-medium text-foreground">Notification settings</Link>
            </div>
          )}
        </MenuButton>
        <MenuButton
          label="Account menu"
          button={<Avatar name={name || email} solid size="md" />}
        >
          <div role="none" className="space-y-1 text-sm">
            <p className="truncate px-2 pt-1 text-muted">{email}</p>
            <div role="none" className="px-1">{installSlot}</div>
            <div role="none" className="border-t border-line pt-1">{signOutSlot}</div>
          </div>
        </MenuButton>
      </div>
    </div>
  );
}

function NoticeBar({ notice }: { notice: ShellNotice }) {
  const key = `pe-notice-${notice.id}`;
  // Dismissed for this browser session. The server always renders it (so there is no layout shift for most people); a browser that dismissed it earlier hides it after loading.
  const subscribe = (notify: () => void) => { window.addEventListener("pe-notice", notify); return () => window.removeEventListener("pe-notice", notify); };
  const dismissed = useSyncExternalStore(subscribe, () => { try { return sessionStorage.getItem(key) === "1"; } catch { return false; } }, () => false);
  if (dismissed) return null;
  const danger = notice.tone === "danger";
  return (
    <div role="note" className={`mx-4 flex items-center gap-3 rounded-card border px-4 py-2.5 text-sm md:mx-8 ${danger ? "border-[#F5C6C2] bg-[#FEF3F2]" : "border-[#F2DFA8] bg-[#FFF8E6]"}`}>
      <Icon name="shield" size={18} className={danger ? "text-[#B42318]" : "text-[#9A6700]"} />
      <p className="min-w-0 flex-1">{notice.text}</p>
      <Link href={notice.actionHref} className="shrink-0 font-medium text-foreground">{notice.actionLabel}</Link>
      <button type="button" aria-label="Dismiss" onClick={() => { try { sessionStorage.setItem(key, "1"); } catch { /* ignore */ } window.dispatchEvent(new Event("pe-notice")); }} className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-muted outline-none hover:bg-black/[0.05] focus-visible:outline-2 focus-visible:outline-[var(--signal-strong)]">
        <Icon name="x" />
      </button>
    </div>
  );
}

/** Phones: the four main places and More, which opens everything else. Hidden on the case study editor, which has its own bottom controls. */
function BottomBar({ isPlatformAdmin }: { isPlatformAdmin: boolean }) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const [openedAt, setOpenedAt] = useState(pathname);
  if (moreOpen && openedAt !== pathname) setMoreOpen(false);
  if (/^\/app\/case-studies\/[^/]+\/(edit|review|template)$/.test(pathname)) return null;

  const tabs: NavItem[] = TAB_ITEMS;
  const moreActive = !tabs.some((tab) => isActive(pathname, tab.href));
  const groups = NAV_GROUPS.slice(1).map((group) => (group.label === "Workspace" && isPlatformAdmin ? { ...group, items: [...group.items, ADMIN_ITEM] } : group));
  const cell = "relative flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 text-[11px] outline-none no-underline hover:no-underline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--signal-strong)]";

  return (
    <>
      <nav data-anim="G-06" aria-label="Quick links" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <ul className="mx-auto grid max-w-md grid-cols-5">
          {tabs.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <li key={item.href}>
                <Link href={item.href} aria-current={active ? "page" : undefined} className={cell}>
                  {active && <m.span layoutId="bottom-pill" transition={spring("default")} className="absolute inset-x-2 inset-y-1.5 rounded-control bg-tint" />}
                  <Icon key={active ? "on" : "off"} name={item.icon} size={20} className={`relative ${active ? "anim-icon-bounce text-[var(--signal-strong)]" : "text-muted"}`} />
                  <span className={`relative ${active ? "font-medium" : "text-muted"}`}>{item.label}</span>
                </Link>
              </li>
            );
          })}
          <li>
            <button type="button" aria-haspopup="dialog" onClick={() => { setOpenedAt(pathname); setMoreOpen(true); }} className={`${cell} w-full`}>
              {moreActive && <m.span layoutId="bottom-pill" transition={spring("default")} className="absolute inset-x-2 inset-y-1.5 rounded-control bg-tint" />}
              <Icon name="more" size={20} className={`relative ${moreActive ? "text-[var(--signal-strong)]" : "text-muted"}`} />
              <span className={`relative ${moreActive ? "font-medium" : "text-muted"}`}>More</span>
            </button>
          </li>
        </ul>
      </nav>
      <Dialog open={moreOpen} onClose={() => setMoreOpen(false)} title="More">
        <div className="max-h-[60dvh] space-y-4 overflow-y-auto">
          {groups.map((group) => (
            <div key={group.label}>
              <p className="pb-1 text-xs font-medium uppercase tracking-wider text-muted">{group.label}</p>
              <ul>
                {group.items.map((item) => (
                  <li key={item.href}><Link href={item.href} aria-current={isActive(pathname, item.href) ? "page" : undefined} className="flex min-h-11 items-center gap-3 rounded-control px-2 text-sm no-underline hover:bg-black/[0.04] hover:no-underline"><Icon name={item.icon} className="text-muted" />{item.label}</Link></li>
                ))}
                {group.label === "Workspace" && (
                  <>
                    <li className="px-2 pt-2 text-xs text-muted">Settings</li>
                    {SETTINGS_ITEMS.map((item) => (
                      <li key={item.href}><Link href={item.href} aria-current={isActive(pathname, item.href) ? "page" : undefined} className="flex min-h-11 items-center gap-3 rounded-control px-2 text-sm no-underline hover:bg-black/[0.04] hover:no-underline"><Icon name={item.icon} className="text-muted" />{item.label}</Link></li>
                    ))}
                  </>
                )}
              </ul>
            </div>
          ))}
        </div>
      </Dialog>
    </>
  );
}

export function AppShell({ workspace, user, isPlatformAdmin, notice, initialCollapsed, installSlot, signOutSlot, footer, children }: Props) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const pathname = usePathname();
  // The case study editor is a wide tool: the sidebar folds to icons and the page uses the full width.
  const editorRoute = /^\/app\/case-studies\/[^/]+\/(edit|review|template)$/.test(pathname) || /^\/app\/demos\/[^/]+$/.test(pathname);

  const toggle = () => {
    setCollapsed((current) => {
      const next = !current;
      const secure = window.location.protocol === "https:" ? "; Secure" : "";
      document.cookie = `${SIDEBAR_COOKIE}=${next ? "collapsed" : "open"}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
      return next;
    });
  };

  // Ctrl or Cmd + B, like most editors.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b" && !event.shiftKey && !event.altKey) {
        const target = event.target as HTMLElement | null;
        if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
        event.preventDefault();
        toggle();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="min-h-dvh md:flex">
      <a href="#main" className="sr-only z-[70] rounded-control bg-foreground px-4 py-2 text-sm font-medium text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4">Skip to content</a>
      <Sidebar collapsed={collapsed || editorRoute} onToggle={toggle} workspace={workspace} isPlatformAdmin={isPlatformAdmin} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar email={user.email} name={workspace.name} installSlot={installSlot} signOutSlot={signOutSlot} />
        {notice ? <NoticeBar notice={notice} /> : null}
        <main id="main" tabIndex={-1} className={`mx-auto w-full flex-1 px-4 py-6 pb-24 sm:px-8 md:pb-8 ${editorRoute ? "max-w-none" : "max-w-6xl"}`}>{children}</main>
        {footer}
      </div>
      <BottomBar isPlatformAdmin={isPlatformAdmin} />
    </div>
  );
}
