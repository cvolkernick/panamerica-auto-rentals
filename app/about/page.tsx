import type { Metadata } from "next";

import { legal } from "@/lib/site";

export const metadata: Metadata = {
  title: "About",
  description:
    "Legal entity facts for Panamerica Auto, LLC, a Florida limited liability company.",
};

const facts = [
  ["Legal name", legal.entityName],
  ["Trade name", "Panamerica Auto Rentals"],
  ["Document number", legal.docNumber],
  ["Status", legal.status],
  ["Entity type", legal.jurisdiction],
  ["Filed", legal.filed],
  ["Authorized member", legal.authorizedMember],
  ["Registered agent", legal.registeredAgent.name],
  ["Registered agent address", legal.registeredAgent.address],
] as const;

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6 sm:py-20">
      <p className="font-heading text-xs tracking-[0.28em] text-gold uppercase">
        About / legal
      </p>
      <h1 className="mt-3 text-4xl font-bold text-white sm:text-5xl">
        The company on record
      </h1>
      <p className="mt-5 text-lg leading-relaxed text-white/75">
        Facts below are from the Florida Sunbiz record verified 2026-09-03. This
        page is the legal entity, not a brochure of offices or a team roster.
      </p>

      <dl className="mt-10 divide-y divide-white/10 overflow-hidden rounded-xl bg-navy-mid ring-1 ring-white/10">
        {facts.map(([term, value]) => (
          <div
            key={term}
            className="grid gap-1 px-5 py-4 sm:grid-cols-[13rem_1fr] sm:items-baseline"
          >
            <dt className="font-heading text-xs tracking-[0.16em] text-white/55 uppercase">
              {term}
            </dt>
            <dd className="text-base text-white">{value}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-6 text-sm leading-relaxed text-white/60">
        The St. Petersburg suite is the registered-agent mailing address on the
        Sunbiz filing. It is not an operating headquarters.
      </p>
      <p className="mt-3 text-sm leading-relaxed text-white/60">
        <a
          href={legal.sunbizSearch}
          className="text-gold underline decoration-gold/40 underline-offset-4 hover:text-white"
        >
          Search the Sunbiz record
        </a>{" "}
        for {legal.entityName}.
      </p>
    </div>
  );
}
