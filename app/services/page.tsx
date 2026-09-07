import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { services, turoGuestUrl } from "@/lib/site";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Services",
  description:
    "Fleet management, Turo and rideshare platform operations, and automotive logistics from Panamerica Auto, LLC.",
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
        Short descriptions only. No case studies, no invented fleet counts, and
        no vehicle listings on this site.
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
          </article>
        ))}
      </div>
      <p className="mt-10 text-base leading-relaxed text-white/70">
        Placing a vehicle with us? See the{" "}
        <Link href="/plans" className="text-gold hover:underline">
          owner management plans
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
          <Link href="/plans">Owner plans</Link>
        </Button>
        <Button
          asChild
          variant="outline"
          className="h-11 border-white/20 bg-transparent px-5 font-heading tracking-[0.16em] text-white uppercase hover:bg-white/10"
        >
          <a href={turoGuestUrl} rel="noopener noreferrer">
            Turo
          </a>
        </Button>
      </div>
    </div>
  );
}
