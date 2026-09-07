import Link from "next/link";

import {
  CONTACT_PHONE_DISPLAY,
  CONTACT_PHONE_TEL,
  getContactEmail,
  legal,
  nav,
} from "@/lib/site";

export function SiteFooter() {
  const email = getContactEmail();

  return (
    <footer className="mt-auto border-t border-white/10 bg-black">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-heading text-lg tracking-[0.2em] text-white uppercase">
              Panamerica Auto Rentals
            </p>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-white/65">
              {legal.entityName} — fleet management and automotive logistics
              for assets on Turo and other rideshare platforms.
            </p>
          </div>
          <nav aria-label="Footer">
            <ul className="flex flex-wrap gap-x-4 gap-y-2">
              {nav.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="font-heading text-xs tracking-[0.16em] text-white/70 uppercase hover:text-white"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
              <li>
                <a
                  href={`tel:${CONTACT_PHONE_TEL}`}
                  className="font-heading text-xs tracking-[0.16em] text-gold uppercase hover:text-white"
                >
                  {CONTACT_PHONE_DISPLAY}
                </a>
              </li>
              <li>
                <a
                  href={`mailto:${email}`}
                  className="font-heading text-xs tracking-[0.16em] text-gold uppercase hover:text-white"
                >
                  {email}
                </a>
              </li>
            </ul>
          </nav>
        </div>
        <p className="text-sm leading-relaxed text-white/55">
          {legal.entityName} · {legal.jurisdiction} · Doc {legal.docNumber} ·{" "}
          {legal.status}.{" "}
          <a
            href={legal.sunbizSearch}
            className="text-white/80 underline decoration-white/30 underline-offset-4 hover:text-white"
          >
            Sunbiz record
          </a>
        </p>
      </div>
    </footer>
  );
}
