import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { SITE_NAME, socialMetadata } from "@/lib/seo";

const description =
  "Car rentals for rideshare and delivery drivers in Fort Myers and Cape Coral, FL. From $300 a week. Bring your own insurance or choose a daily insurance option.";

export const metadata: Metadata = {
  title: "Gig driver car rentals in Fort Myers & Cape Coral",
  description,
  ...socialMetadata({
    title: `Gig driver car rentals in Fort Myers & Cape Coral · ${SITE_NAME}`,
    description,
    path: "/drivers",
  }),
};

const points = [
  {
    title: "From $300 a week",
    body: "Simple weekly pricing for drivers who want a reliable car to work rideshare and delivery shifts.",
  },
  {
    title: "Your insurance or ours",
    body: "Bring your own insurance, or daily insurance options are available.",
  },
  {
    title: "Local to Southwest Florida",
    body: "We manage our fleet in Fort Myers and Cape Coral, so pickup, maintenance, and support stay close to where you drive.",
  },
] as const;

export default function DriversPage() {
  return (
    <div className="mx-auto w-full min-w-0 max-w-3xl px-4 py-14 sm:px-6 sm:py-20">
      <p className="font-heading text-xs tracking-[0.28em] text-gold uppercase">
        Drivers
      </p>
      <h1 className="mt-3 text-4xl font-bold text-white sm:text-5xl">
        Gig driver car rentals in Fort Myers and Cape Coral
      </h1>
      <p className="mt-5 text-lg leading-relaxed text-white/75">
        Drive for rideshare and delivery without buying a car. Panamerica Auto
        Rentals rents clean, well-maintained vehicles by the day, week, or
        month to gig drivers in Fort Myers and Cape Coral.
      </p>
      <p className="mt-3 text-lg leading-relaxed text-white/75">
        Longer rentals get better rates.
      </p>

      <aside
        className="mt-8 rounded-xl border border-gold/30 bg-navy-mid p-6 ring-1 ring-white/10 sm:p-8"
        aria-label="Toll offer"
      >
        <p className="font-heading text-[0.7rem] tracking-[0.22em] text-gold uppercase">
          New drivers
        </p>
        <p className="mt-3 text-base leading-relaxed text-white/80">
          Ask us about your first month of tolls.
        </p>
      </aside>

      <ul className="mt-10 grid gap-6">
        {points.map((p) => (
          <li
            key={p.title}
            className="rounded-xl border-l-4 border-gold bg-navy-mid p-6 ring-1 ring-white/10 sm:p-8"
          >
            <h2 className="text-2xl font-bold text-white">{p.title}</h2>
            <p className="mt-3 text-base leading-relaxed text-white/75">
              {p.body}
            </p>
          </li>
        ))}
      </ul>

      <section className="mt-12">
        <h2 className="text-2xl font-bold text-white">Ready to drive?</h2>
        <p className="mt-3 text-base leading-relaxed text-white/75">
          Send us a note through our inquiry form with when you want to start
          and how you plan to drive, and we will follow up with available cars.
        </p>
        <Button asChild className="mt-6">
          <Link href="/contact">Send an inquiry</Link>
        </Button>
      </section>
    </div>
  );
}
