import type { Metadata } from "next";
import Link from "next/link";

import { PlanHashRedirect } from "@/components/plan-hash-redirect";
import { Button } from "@/components/ui/button";
import { getContactEmail, ownerPlans } from "@/lib/site";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Owner plans",
  description:
    "Owner management service plans from Panamerica Auto, LLC — 80/20 standard, 50/50 guaranteed payment, and 20/80 owner exit.",
};

const accent = {
  red: "border-red",
  blue: "border-royal",
  green: "border-green",
} as const;

const accentBar = {
  red: "bg-red",
  blue: "bg-royal",
  green: "bg-green",
} as const;

export default function PlansPage() {
  const email = getContactEmail();

  return (
    <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6 sm:py-20">
      <PlanHashRedirect />
      <p className="font-heading text-xs tracking-[0.28em] text-gold uppercase">
        Owner plans
      </p>
      <h1 className="mt-3 text-4xl font-bold text-white sm:text-5xl">
        Management service plans
      </h1>
      <p className="mt-5 text-lg leading-relaxed text-white/75">
        Three service plans for owners who want Panamerica to run a vehicle on
        Turo and other rideshare platforms. Splits are owner% / company%. These
        are operations and fleet-management services — not an investment,
        security, or offer to sell a security.
      </p>

      <div className="mt-10 grid gap-8">
        {ownerPlans.map((plan) => (
          <article
            key={plan.slug}
            id={plan.slug}
            className={cn(
              "rounded-xl border-l-4 bg-navy-mid p-6 ring-1 ring-white/10 sm:p-8",
              accent[plan.accent]
            )}
          >
            <span
              aria-hidden
              className={cn("mb-4 block h-1 w-12 rounded-full", accentBar[plan.accent])}
            />
            <p className="font-heading text-[0.7rem] tracking-[0.22em] text-white/50 uppercase">
              {plan.split} · Owner {plan.ownerShare} / company {plan.companyShare}
            </p>
            <h2 className="mt-2 text-2xl font-bold text-white">{plan.title}</h2>
            <dl className="mt-6 divide-y divide-white/10">
              {plan.details.map((item) => (
                <div
                  key={item.heading}
                  className="grid gap-1 py-4 first:pt-0 last:pb-0 sm:grid-cols-[11rem_1fr] sm:items-baseline"
                >
                  <dt className="font-heading text-xs tracking-[0.16em] text-white/55 uppercase">
                    {item.heading}
                  </dt>
                  <dd className="text-base leading-relaxed text-white/80">
                    {item.body}
                  </dd>
                </div>
              ))}
            </dl>
          </article>
        ))}
      </div>

      <p className="mt-10 text-sm leading-relaxed text-white/55">
        This page is general information about our management services, not
        legal or tax advice. A written management agreement confirms terms for
        any vehicle.
      </p>

      <div className="mt-8 rounded-xl bg-navy-mid p-6 ring-1 ring-white/10 sm:flex sm:items-center sm:justify-between sm:p-8">
        <p className="max-w-xl text-base leading-relaxed text-white/80">
          Want to place a car on a plan? Write us at{" "}
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
