import Image from "next/image";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ownerPlans, positioning, services, turoGuestUrl } from "@/lib/site";
import { cn } from "@/lib/utils";

const accentBar: Record<(typeof services)[number]["accent"], string> = {
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
                <Link href="/contact">Get in touch</Link>
              </Button>
              <Button
                asChild
                variant="outline"
                className="h-12 border-white/20 bg-transparent px-6 font-heading tracking-[0.18em] text-white uppercase hover:bg-white/10"
              >
                <Link href="/plans">Owner plans</Link>
              </Button>
              <Button
                asChild
                variant="outline"
                className="h-12 border-white/20 bg-transparent px-6 font-heading tracking-[0.18em] text-white uppercase hover:bg-white/10"
              >
                <a href={turoGuestUrl} rel="noopener noreferrer">
                  Turo
                </a>
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
              Three lines of work
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
                  className={cn("mb-3 block h-1 w-12 rounded-full", accentBar[service.accent])}
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
                </CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
        <div className="mt-10 rounded-xl bg-navy-mid p-6 ring-1 ring-white/10 sm:flex sm:items-center sm:justify-between sm:p-8">
          <p className="max-w-xl text-base leading-relaxed text-white/80">
            Need fleet, platform, or logistics help? Write us.
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
                Owner plans
              </p>
              <h2 className="mt-2 text-3xl font-bold text-white sm:text-4xl">
                Three management plans
              </h2>
              <p className="mt-3 max-w-2xl text-base leading-relaxed text-white/70">
                Owner plans for people who want the car run for them — clear
                who pays what, and what share you keep.
              </p>
            </div>
            <Link
              href="/plans"
              className="font-heading text-sm tracking-[0.16em] text-white/70 uppercase hover:text-white"
            >
              Read the plans
            </Link>
          </div>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {ownerPlans.map((plan) => (
              <Card
                key={plan.slug}
                className="border-0 bg-navy-mid ring-white/10"
              >
                <CardHeader>
                  <span
                    aria-hidden
                    className={cn("mb-3 block h-1 w-12 rounded-full", accentBar[plan.accent])}
                  />
                  <p className="font-heading text-[0.7rem] tracking-[0.2em] text-white/50 uppercase">
                    {plan.split} · Owner {plan.ownerShare} / company{" "}
                    {plan.companyShare}
                  </p>
                  <CardTitle className="font-heading text-xl tracking-[0.12em] text-white uppercase">
                    <Link href={`/plans#${plan.slug}`} className="hover:text-gold">
                      {plan.title}
                    </Link>
                  </CardTitle>
                  <CardDescription className="text-base leading-relaxed text-white/70">
                    {plan.summary}
                  </CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
