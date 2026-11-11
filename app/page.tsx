import Image from "next/image";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  managementPlan,
  noLockInTeaser,
  planAccentBar,
  positioning,
  services,
} from "@/lib/site";
import { cn } from "@/lib/utils";

const serviceAccentBar: Record<(typeof services)[number]["accent"], string> = {
  red: "bg-red",
  blue: "bg-royal",
  green: "bg-green",
};

export default function HomePage() {
  return (
    <div>
      <section className="relative overflow-hidden border-b border-white/10">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(47,91,255,0.18),_transparent_42%),radial-gradient(circle_at_80%_20%,_rgba(225,29,46,0.16),_transparent_35%),linear-gradient(180deg,_#070b16,_#0b1222_70%)]"
        />
        <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-[minmax(0,22rem)_1fr] lg:gap-16">
          <div className="mx-auto w-full max-w-sm lg:mx-0">
            <Image
              src="/logo.jpg"
              alt="Panamerica Auto Rentals logo: silver sports coupe with a red stripe, speed streaks, and white wordmark"
              width={1024}
              height={1536}
              priority
              className="h-auto w-full rounded-xl shadow-[0_24px_80px_rgba(0,0,0,0.45)] ring-1 ring-white/15"
            />
          </div>
          <div className="min-w-0">
            <p className="font-heading text-xs tracking-[0.32em] text-gold uppercase">
              Panamerica Auto, LLC
            </p>
            <h1 className="mt-3 text-4xl leading-[0.95] font-bold tracking-[0.14em] text-white sm:text-5xl lg:text-6xl">
              Panamerica
              <span className="mt-2 block text-2xl tracking-[0.28em] text-white/80 sm:text-3xl">
                Auto Rentals
              </span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-white/80 sm:text-xl">
              {positioning}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button
                asChild
                className="h-12 bg-red px-6 font-heading tracking-[0.18em] text-white uppercase hover:bg-red/90"
              >
                <Link href="/fleet">Book Direct</Link>
              </Button>
              <Button
                asChild
                variant="outline"
                className="h-12 border-white/20 bg-transparent px-6 font-heading tracking-[0.18em] text-white uppercase hover:bg-white/10"
              >
                <Link href="/drivers">Driver rentals</Link>
              </Button>
              <Button
                asChild
                variant="outline"
                className="h-12 border-white/20 bg-transparent px-6 font-heading tracking-[0.18em] text-white uppercase hover:bg-white/10"
              >
                <Link href="/partners">Fleet partners</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-heading text-xs tracking-[0.28em] text-gold uppercase">
              What we do
            </p>
            <h2 className="mt-2 text-3xl font-bold text-white sm:text-4xl">
              By the day, week, or month
            </h2>
          </div>
          <Link
            href="/services"
            className="font-heading text-sm tracking-[0.16em] text-white/70 uppercase hover:text-white"
          >
            Read the services
          </Link>
        </div>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {services.map((service) => (
            <Card
              key={service.slug}
              className="border-0 bg-navy-mid ring-white/10"
            >
              <CardHeader>
                <span
                  aria-hidden
                  className={cn("mb-3 block h-1 w-12 rounded-full", serviceAccentBar[service.accent])}
                />
                {"eyebrow" in service ? (
                  <p className="font-heading text-[0.7rem] tracking-[0.2em] text-white/50 uppercase">
                    {service.eyebrow}
                  </p>
                ) : null}
                <CardTitle className="font-heading text-xl tracking-[0.12em] text-white uppercase">
                  {service.title}
                </CardTitle>
                <CardDescription className="text-base leading-relaxed text-white/70">
                  {service.summary}
                  <Link
                    href={service.href}
                    className="mt-3 block font-heading text-sm tracking-[0.16em] text-gold uppercase hover:text-white"
                  >
                    {service.linkLabel}
                  </Link>
                </CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
        <div className="mt-10 rounded-xl bg-navy-mid p-6 ring-1 ring-white/10 sm:flex sm:items-center sm:justify-between sm:p-8">
          <p className="max-w-xl text-base leading-relaxed text-white/80">
            Need a rental, or want to place a car with us? Write us.
          </p>
          <Button
            asChild
            className="mt-4 h-11 bg-gold px-5 font-heading tracking-[0.16em] text-navy uppercase hover:bg-gold/90 sm:mt-0"
          >
            <Link href="/contact">Contact</Link>
          </Button>
        </div>
      </section>

      <section className="border-t border-white/10">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="font-heading text-xs tracking-[0.28em] text-gold uppercase">
                Owner plan
              </p>
              <h2 className="mt-2 text-3xl font-bold text-white sm:text-4xl">
                One management plan
              </h2>
              <p className="mt-3 max-w-2xl text-base leading-relaxed text-white/70">
                This plan is for vehicle owners. To rent a car,{" "}
                <Link href="/fleet" className="text-gold hover:underline">
                  book direct
                </Link>{" "}
                on the fleet or see{" "}
                <Link href="/drivers" className="text-gold hover:underline">
                  driver rentals
                </Link>
                . {managementPlan.summary}{" "}
                <Link href="/partners" className="text-gold hover:underline">
                  Fleet partners
                </Link>{" "}
                lists who we work with.
              </p>
              <p className="mt-3 max-w-2xl text-base leading-relaxed text-gold/90">
                {noLockInTeaser.body}
              </p>
            </div>
            <Link
              href="/management"
              className="font-heading text-sm tracking-[0.16em] text-white/70 uppercase hover:text-white"
            >
              Read the plan
            </Link>
          </div>
          <Card className="mt-8 border-0 bg-navy-mid ring-white/10">
            <CardHeader>
              <span
                aria-hidden
                className={cn(
                  "mb-3 block h-1 w-12 rounded-full",
                  planAccentBar[managementPlan.accent]
                )}
              />
              <p className="font-heading text-[0.7rem] tracking-[0.2em] text-white/50 uppercase">
                Commission by trip length
              </p>
              <CardTitle className="font-heading text-xl tracking-[0.12em] text-white uppercase">
                <Link
                  href="/management"
                  className="hover:text-gold"
                >
                  {managementPlan.title}
                </Link>
              </CardTitle>
              <CardDescription className="text-base leading-relaxed text-white/70">
                <ul className="mt-1 grid gap-3 sm:grid-cols-3">
                  {managementPlan.tiers.map((tier) => (
                    <li
                      key={tier.rate}
                      className="rounded-lg bg-navy px-4 py-4 ring-1 ring-white/10"
                    >
                      <span className="block font-heading text-2xl tracking-[0.08em] text-gold">
                        {tier.rate}
                      </span>
                      <span className="mt-1 block text-sm leading-relaxed text-white/75">
                        {tier.label}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-4 text-sm leading-relaxed text-white/75">
                  {managementPlan.firstMonth}
                </p>
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </section>
    </div>
  );
}
