import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { SITE_NAME, socialMetadata } from "@/lib/seo";
import { about, getContactEmail, legal } from "@/lib/site";

const description =
  "A small, highly capable fleet management team with over a decade of combined experience across Southeastern markets — Panamerica Auto Rentals, the trade name of Panamerica Auto, LLC.";

export const metadata: Metadata = {
  title: "About",
  description,
  ...socialMetadata({
    title: `About · ${SITE_NAME}`,
    description,
    path: "/about",
  }),
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
  const email = getContactEmail();

  return (
    <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6 sm:py-20">
      <p className="font-heading text-xs tracking-[0.28em] text-gold uppercase">
        About
      </p>
      <h1 className="mt-3 text-4xl font-bold text-white sm:text-5xl">
        {about.title}
      </h1>
      {about.paragraphs.map((paragraph) => (
        <p
          key={paragraph}
          className="mt-5 text-lg leading-relaxed text-white/75"
        >
          {paragraph}
        </p>
      ))}

      <div className="mt-8">
        <p className="font-heading text-[0.7rem] tracking-[0.22em] text-white/50 uppercase">
          Southeastern markets
        </p>
        <ul className="mt-3 flex flex-wrap gap-2">
          {about.markets.map((market) => (
            <li
              key={market}
              className="rounded-full bg-navy-mid px-3 py-1.5 font-heading text-xs tracking-[0.14em] text-white/80 uppercase ring-1 ring-white/10"
            >
              {market}
            </li>
          ))}
        </ul>
      </div>

      <section className="mt-10 rounded-xl bg-navy-mid p-6 ring-1 ring-white/10 sm:p-8">
        <p className="font-heading text-xs tracking-[0.28em] text-gold uppercase">
          Fleet partners
        </p>
        <p className="mt-3 text-base leading-relaxed text-white/80">
          Meet some of our fleet partners — hosts and operators we work with on
          Turo and related work.
        </p>
        <Link
          href="/partners"
          className="mt-4 inline-block font-heading text-sm tracking-[0.16em] text-gold uppercase hover:text-white"
        >
          Fleet partners
        </Link>
      </section>

      <section className="mt-14">
        <p className="font-heading text-xs tracking-[0.28em] text-gold uppercase">
          Legal entity
        </p>
        <h2 className="mt-3 text-2xl font-bold text-white">
          {legal.entityName}
        </h2>
        <dl className="mt-6 divide-y divide-white/10 overflow-hidden rounded-xl bg-navy-mid ring-1 ring-white/10">
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
          The St. Petersburg suite is the registered-agent mailing address on
          the Sunbiz filing. It is not an operating headquarters.
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
      </section>

      <div className="mt-10 rounded-xl bg-navy-mid p-6 ring-1 ring-white/10 sm:flex sm:items-center sm:justify-between sm:p-8">
        <p className="max-w-xl text-base leading-relaxed text-white/80">
          Want to talk about fleet operations or an owner plan? Write us at{" "}
          <a href={`mailto:${email}`} className="text-gold hover:underline">
            {email}
          </a>
          .
        </p>
        <Button
          asChild
          className="mt-4 h-11 bg-gold px-5 font-heading tracking-[0.16em] text-navy uppercase hover:bg-gold/90 sm:mt-0"
        >
          <Link href="/contact">Contact</Link>
        </Button>
      </div>
    </div>
  );
}
