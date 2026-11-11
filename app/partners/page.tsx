import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { SITE_NAME, socialMetadata } from "@/lib/seo";
import {
  fleetPartners,
  managementPlan,
  planAccentBar,
  planAccentBorder,
} from "@/lib/site";
import { cn } from "@/lib/utils";

const description =
  "Curated fleet partners of Panamerica Auto, LLC — hosts and operators we work with. No scraped listings, ratings, or invented vehicles.";

export const metadata: Metadata = {
  title: "Fleet partners",
  description,
  ...socialMetadata({
    title: `Fleet partners · ${SITE_NAME}`,
    description,
    path: "/partners",
  }),
};

export default function PartnersPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6 sm:py-20">
      <p className="font-heading text-xs tracking-[0.28em] text-gold uppercase">
        Fleet partners
      </p>
      <h1 className="mt-3 text-4xl font-bold text-white sm:text-5xl">
        People we work with
      </h1>
      <p className="mt-4 text-base leading-relaxed text-white/65">
        Client rentals come first.{" "}
        <Link href="/fleet" className="text-gold hover:underline">
          Book direct
        </Link>{" "}
        on the fleet, or see{" "}
        <Link href="/drivers" className="text-gold hover:underline">
          driver rentals
        </Link>{" "}
        for gig and rideshare drivers in Fort Myers and Cape Coral. This page
        is for vehicle owners and the people we work with.
      </p>
      <section className="mt-10" aria-label="Fleet management commission">
        <article
          className={cn(
            "rounded-xl border-l-4 bg-navy-mid p-6 ring-1 ring-white/10 sm:p-8",
            planAccentBorder[managementPlan.accent]
          )}
        >
          <span
            aria-hidden
            className={cn(
              "mb-4 block h-1 w-12 rounded-full",
              planAccentBar[managementPlan.accent]
            )}
          />
          <p className="font-heading text-[0.7rem] tracking-[0.22em] text-gold uppercase">
            Commission by trip length
          </p>
          <h2 className="mt-2 text-2xl font-bold text-white">
            <Link
              href="/management"
              className="hover:text-gold"
            >
              {managementPlan.title}
            </Link>
          </h2>
          <ul className="mt-5 grid gap-3 sm:grid-cols-3">
            {managementPlan.tiers.map((tier) => (
              <li
                key={tier.rate}
                className="rounded-lg bg-navy px-4 py-4 ring-1 ring-white/10"
              >
                <p className="font-heading text-2xl tracking-[0.08em] text-gold">
                  {tier.rate}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-white/75">
                  {tier.label}
                </p>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-base leading-relaxed text-white/80">
            {managementPlan.firstMonth}
          </p>
        </article>
      </section>

      <ul className="mt-10 grid gap-6">
        {fleetPartners.map((partner) => (
          <li key={partner.slug}>
            <article
              className={cn(
                "rounded-xl border-l-4 bg-navy-mid p-6 ring-1 ring-white/10 sm:p-8",
                planAccentBorder[partner.accent]
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "mb-4 block h-1 w-12 rounded-full",
                  planAccentBar[partner.accent]
                )}
              />
              <p className="font-heading text-[0.7rem] tracking-[0.22em] text-white/50 uppercase">
                Fleet partner
                {"brand" in partner && partner.brand
                  ? ` · ${partner.brand}`
                  : null}
              </p>
              <h2 className="mt-2 text-2xl font-bold text-white">
                {partner.name}
                {"shortName" in partner && partner.shortName
                  ? ` (${partner.shortName})`
                  : null}
              </h2>
              {partner.note ? (
                <p className="mt-4 text-base leading-relaxed text-white/75">
                  {partner.note}
                </p>
              ) : null}
              {partner.vehicles.length > 0 ? (
                <div className="mt-5">
                  <p className="font-heading text-[0.7rem] tracking-[0.22em] text-white/50 uppercase">
                    Vehicles
                  </p>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {partner.vehicles.map((vehicle) => (
                      <li
                        key={vehicle}
                        className="rounded-full bg-navy px-3 py-1.5 font-heading text-xs tracking-[0.14em] text-white/80 uppercase ring-1 ring-white/10"
                      >
                        {vehicle}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
                {partner.links.map((link) =>
                  "href" in link ? (
                    <a
                      key={link.href}
                      href={link.href}
                      rel="noopener noreferrer"
                      className="font-heading text-sm tracking-[0.16em] text-gold uppercase hover:text-white"
                    >
                      {link.label}
                    </a>
                  ) : (
                    <span
                      key={link.label}
                      className="font-heading text-sm tracking-[0.16em] text-white/70 uppercase"
                    >
                      {link.label}
                    </span>
                  )
                )}
                {partner.profileStatus === "coming" ? (
                  <span className="font-heading text-sm tracking-[0.16em] text-white/45 uppercase">
                    Profile coming
                  </span>
                ) : null}
              </div>
            </article>
          </li>
        ))}
      </ul>

      <div className="mt-10 rounded-xl bg-navy-mid p-6 ring-1 ring-white/10 sm:flex sm:items-center sm:justify-between sm:p-8">
        <p className="max-w-xl text-base leading-relaxed text-white/80">
          One management plan. Commission is 20% under 7 days, 15% for 7–21
          days, and 10% over 21 days. {managementPlan.firstMonth}
        </p>
        <Button
          asChild
          className="mt-4 h-11 bg-gold px-5 font-heading tracking-[0.16em] text-navy uppercase hover:bg-gold/90 sm:mt-0"
        >
          <Link href="/management">Fleet Management</Link>
        </Button>
      </div>
    </div>
  );
}
