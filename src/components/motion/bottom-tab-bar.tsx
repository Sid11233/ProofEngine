"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { m } from "motion/react";
import { spring } from "@/lib/motion/springs";

export interface TabItem {
  href: string;
  label: string;
  /** Path data for a 24 px stroke icon (2 px, round caps). */
  icon: string;
}

const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

/**
 * G-06 Mobile bottom tab bar: the main places one thumb away. The indicator glides between tabs on the default spring
 * and the tapped icon bounces (scale 1 to 1.15 to 1 over 240 ms, CSS). Reduced motion: the indicator moves instantly
 * and the icon does not bounce.
 */
export function BottomTabBar({ items }: { items: TabItem[] }) {
  const pathname = usePathname();
  // The case study editor has its own fixed controls at the bottom of a phone screen; two bars would fight.
  if (/^\/app\/case-studies\/[^/]+\/(edit|review|template)$/.test(pathname)) return null;
  return (
    <nav data-anim="G-06" aria-label="Quick links" className="fixed inset-x-0 bottom-0 z-30 border-t border-neutral-200 bg-[#faf7f0]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      <ul className="mx-auto grid max-w-md grid-cols-5">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link href={item.href} aria-current={active ? "page" : undefined} className="relative flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px]">
                {active && <m.span layoutId="bottom-tab-indicator" transition={spring("default")} className="absolute inset-x-3 top-0 h-[3px] rounded-full bg-[var(--signal-strong)]" />}
                <svg key={active ? "on" : "off"} viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={active ? "anim-icon-bounce text-[var(--signal-strong)]" : ""}>
                  <path d={item.icon} />
                </svg>
                <span className={active ? "font-medium" : "text-neutral-600"}>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
