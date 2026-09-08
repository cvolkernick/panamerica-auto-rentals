"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cyberfleetNav, nav } from "@/lib/site";
import { cn } from "@/lib/utils";

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-navy/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-3 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
          onClick={() => setOpen(false)}
        >
          <Image
            src="/logo.jpg"
            alt="Panamerica Auto Rentals"
            width={40}
            height={60}
            className="h-10 w-auto rounded-sm ring-1 ring-white/15"
            priority
          />
          <span className="font-heading text-[0.95rem] leading-none tracking-[0.18em] text-white uppercase sm:text-base">
            Panamerica
            <span className="mt-1 block text-[0.62rem] font-semibold tracking-[0.28em] text-white/70">
              Auto Rentals
            </span>
          </span>
        </Link>

        <nav
          aria-label="Primary"
          className="hidden items-center gap-1 md:flex"
        >
          {nav.map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-md px-3 py-2 font-heading text-sm tracking-[0.14em] uppercase transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold",
                  active
                    ? "text-white"
                    : "text-white/65 hover:text-white"
                )}
              >
                {item.label}
              </Link>
            );
          })}
          <Button
            asChild
            className="ml-2 h-9 bg-red px-4 font-heading tracking-[0.16em] text-white uppercase hover:bg-red/90"
          >
            <Link href="/contact">Contact</Link>
          </Button>
          <Link
            href={cyberfleetNav.href}
            className={cn(
              "ml-1 rounded-md px-2 py-2 font-heading text-[0.65rem] tracking-[0.16em] uppercase transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold",
              pathname.startsWith(cyberfleetNav.href)
                ? "text-white/70"
                : "text-white/40 hover:text-white/65"
            )}
          >
            {cyberfleetNav.label}
          </Link>
        </nav>

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 min-w-[4.5rem] border-white/20 bg-transparent px-3 font-heading tracking-[0.14em] text-white uppercase hover:bg-white/10 md:hidden"
          aria-expanded={open}
          aria-controls="mobile-nav"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Close" : "Menu"}
        </Button>
      </div>

      {open ? (
        <nav
          id="mobile-nav"
          aria-label="Mobile"
          className="border-t border-white/10 bg-navy px-4 py-3 md:hidden"
        >
          <ul className="flex flex-col gap-1">
            {nav.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="block rounded-md px-3 py-3 font-heading tracking-[0.16em] text-white uppercase hover:bg-white/5"
                >
                  {item.label}
                </Link>
              </li>
            ))}
            <li>
              <Link
                href={cyberfleetNav.href}
                onClick={() => setOpen(false)}
                className="block rounded-md px-3 py-3 font-heading text-sm tracking-[0.16em] text-white/45 uppercase hover:bg-white/5 hover:text-white/70"
              >
                {cyberfleetNav.label}
              </Link>
            </li>
          </ul>
        </nav>
      ) : null}
    </header>
  );
}
