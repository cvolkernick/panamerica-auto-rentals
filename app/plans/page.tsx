import type { Metadata } from "next";
import Link from "next/link";

import { PlanHashRedirect } from "@/components/plan-hash-redirect";
import { Button } from "@/components/ui/button";
import {
  getContactEmail,
  isSelfServePlan,
  ownerPlans,
  planAccentBar,
  planAccentBorder,
} from "@/lib/site";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Owner plans",
  description:
    "Owner plans from Panamerica Auto, LLC — Spotlight self-serve listing, then fleet management: 80/20 standard, 50/50 guaranteed payment, and 20/80 owner exit.",
};

export default function PlansPage() {
  const email = getContactEmail();

  return (
    <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6 sm:py-20">
      <PlanHashRedirect />
      <p className="font-heading text-xs tracking-[0.28em] text-gold uppercase">
        Owner plans
      </p>
      <h1 className="mt-3 text-4xl font-bold text-white sm:text-5xl">
        A ladder, not a menu
      </h1>
      <p className="mt-5 text-lg leading-relaxed text-white/75">
        Four rungs, in order: start with Spotlight if you still handle
        day-to-day yourself. Step into fleet management when you want us on
        operations — 80/20 standard, then 50/50 with a payment guarantee, then
        Owner exit. Splits on fleet-management rungs are owner% / company%.
      </p>
      <p className="mt-4 text-base leading-relaxed text-white/65">
        These are operations and fleet-management services — not an investment,
        security, or offer to sell a security.
      </p>

      <ol className="mt-10 grid gap-8">
        {ownerPlans.map((plan) => (
          <li key={plan.slug}>
            <article
              id={plan.slug}
              className={cn(
                "rounded-xl border-l-4 bg-navy-mid p-6 ring-1 ring-white/10 sm:p-8",
                planAccentBorder[plan.accent]
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "mb-4 block h-1 w-12 rounded-full",
                  planAccentBar[plan.accent]
                )}
              />
              <p className="font-heading text-[0.7rem] tracking-[0.22em] text-white/50 uppercase">
                Rung {plan.rung} of {ownerPlans.length} · {plan.category}
                {isSelfServePlan(plan)
                  ? ` · ${plan.fee}`
                  : ` · ${plan.split} · Owner ${plan.ownerShare} / company ${plan.companyShare}`}
              </p>
              <h2 className="mt-2 text-2xl font-bold text-white">{plan.title}</h2>
              {isSelfServePlan(plan) ? (
                <p className="mt-4 text-base leading-relaxed text-white/75">
                  {plan.summary}
                </p>
              ) : null}

              {isSelfServePlan(plan) ? (
                <ul className="mt-6 grid gap-3">
                  {plan.tiers.map((tier) => (
                    <li
                      key={tier.price}
                      className="rounded-lg bg-navy px-4 py-4 ring-1 ring-white/10"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="font-heading text-xl tracking-[0.12em] text-gold uppercase">
                          {tier.price}
                          <span className="ml-2 text-xs tracking-[0.16em] text-white/55">
                            / car / month
                          </span>
                        </p>
                        {tier.status === "coming" ? (
                          <span className="rounded-full bg-gold/15 px-2.5 py-1 font-heading text-[0.65rem] tracking-[0.18em] text-gold uppercase">
                            Coming
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-2 font-heading text-sm tracking-[0.12em] text-white uppercase">
                        {tier.name}
                      </p>
                      <p className="mt-2 text-sm leading-relaxed text-white/70">
                        {tier.description}
                      </p>
                      {tier.status === "coming" ? (
                        <p className="mt-2 text-sm leading-relaxed text-white/50">
                          Not available to start. There is no checkout for this
                          rung until the opportunity feed exists.
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}

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
          </li>
        ))}
      </ol>

      <p className="mt-10 text-sm leading-relaxed text-white/55">
        This page is general information about our services, not legal or tax
        advice. A written agreement confirms terms for any vehicle.
      </p>

      <div className="mt-8 rounded-xl bg-navy-mid p-6 ring-1 ring-white/10 sm:flex sm:items-center sm:justify-between sm:p-8">
        <p className="max-w-xl text-base leading-relaxed text-white/80">
          Want to place a car on a plan? Write us at{" "}
          <a href={`mailto:${email}`} className="text-gold hover:underline">
            {email}
          </a>
          . Spotlight $10 and $15 listing rungs can start from that note; the
          $25 feed rung cannot.
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
