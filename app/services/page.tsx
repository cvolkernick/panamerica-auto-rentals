import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { SITE_NAME, socialMetadata } from "@/lib/seo";
import { services } from "@/lib/site";
import { cn } from "@/lib/utils";

const description =
  "Vehicle rentals by the day, week, or month for individuals and gig drivers in Fort Myers and Cape Coral, plus fleet partner programs for owners.";

export const metadata: Metadata = {
  title: "Services",
  description,
  ...socialMetadata({
    title: `Services · ${SITE_NAME}`,
    description,
    path: "/services",
  }),
};

const accent = {
  red: "border-red",
  blue: "border-royal",
  green: "border-green",
} as const;

export default function ServicesPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6 sm:py-20">
      <p className="font-heading text-xs tracking-[0.28em] text-gold uppercase">
        Services
      </p>
      <h1 className="mt-3 text-4xl font-bold text-white sm:text-5xl">
        Work we actually do
      </h1>
      <p className="mt-5 text-lg leading-relaxed text-white/75">
        We rent clean, well-maintained vehicles by the day, week, or month to
        individuals and to gig and rideshare drivers in Fort Myers and Cape
        Coral.{" "}
        <Link href="/fleet" className="text-gold hover:underline">
          Book Direct
        </Link>{" "}
        on the fleet, or see{" "}
        <Link href="/drivers" className="text-gold hover:underline">
          driver rentals
        </Link>
        . Fleet management and partner programs for vehicle owners are on{" "}
        <Link href="/partners" className="text-gold hover:underline">
          fleet partners
        </Link>
        .
      </p>
      <div className="mt-10 grid gap-8">
        {services.map((service) => (
          <article
            key={service.slug}
            id={service.slug}
            className={cn(
              "rounded-xl border-l-4 bg-navy-mid p-6 ring-1 ring-white/10 sm:p-8",
              accent[service.accent]
            )}
          >
            {"eyebrow" in service ? (
              <p className="font-heading text-[0.7rem] tracking-[0.22em] text-white/50 uppercase">
                {service.eyebrow}
              </p>
            ) : null}
            <h2 className="text-2xl font-bold text-white">{service.title}</h2>
            <p className="mt-4 text-base leading-relaxed text-white/75">
              {service.description}
            </p>
            <Link
              href={service.href}
              className="mt-4 inline-block font-heading text-sm tracking-[0.16em] text-gold uppercase hover:text-white"
            >
              {service.linkLabel}
            </Link>
          </article>
        ))}
      </div>
      <p className="mt-10 text-base leading-relaxed text-white/70">
        Renting a car?{" "}
        <Link href="/fleet" className="text-gold hover:underline">
          Book direct
        </Link>{" "}
        on the fleet, or see{" "}
        <Link href="/drivers" className="text-gold hover:underline">
          driver rentals
        </Link>
        . Placing a vehicle with us? See the{" "}
        <Link href="/management" className="text-gold hover:underline">
          Fleet Management
        </Link>{" "}
        and{" "}
        <Link href="/partners" className="text-gold hover:underline">
          fleet partners
        </Link>
        .
      </p>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <Button
          asChild
          className="h-11 bg-red px-5 font-heading tracking-[0.16em] text-white uppercase hover:bg-red/90"
        >
          <Link href="/contact">Contact</Link>
        </Button>
        <Button
          asChild
          variant="outline"
          className="h-11 border-white/20 bg-transparent px-5 font-heading tracking-[0.16em] text-white uppercase hover:bg-white/10"
        >
          <Link href="/management">Fleet Management</Link>
        </Button>
        <Button
          asChild
          variant="outline"
          className="h-11 border-white/20 bg-transparent px-5 font-heading tracking-[0.16em] text-white uppercase hover:bg-white/10"
        >
          <Link href="/fleet">Book Direct</Link>
        </Button>
      </div>
    </div>
  );
}
