"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { m } from "motion/react";
import { spring } from "@/lib/motion/springs";

export interface NavItem {
  href: string;
  label: string;
}

const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

/**
 * G-05 Active nav pill glide: one pill shared between the links (layoutId) that glides to the current page with the
 * default spring. Reduced motion: the pill moves instantly (the motion config turns the spring off).
 */
export function AppNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav data-anim="G-05" aria-label="Main" className="flex gap-1 overflow-x-auto whitespace-nowrap border-b border-neutral-200 px-4 text-sm">
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className="relative inline-flex min-h-11 items-center px-3 hover:underline">
            {active && <m.span layoutId="app-nav-pill" transition={spring("default")} className="absolute inset-x-1 bottom-1 top-1 -z-0 rounded-md bg-black/[0.06]" />}
            <span className={`relative ${active ? "font-medium" : ""}`}>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
