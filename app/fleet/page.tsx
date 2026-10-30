import { existsSync } from "node:fs";
import path from "node:path";

import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { BookDirectButton } from "@/components/book-direct-button";
import { Button } from "@/components/ui/button";
import {
  bookingButtons,
  fleetVehicles,
  vehicleEyebrow,
  vehicleName,
} from "@/data/fleet";
import { SITE_NAME, socialMetadata } from "@/lib/seo";

const description =
  "Cars you can book on Turo and other platforms — Panamerica-managed in Cape Coral and SafeWheels in Punta Gorda.";

export const metadata: Metadata = {
  title: "The Fleet",
  description,
  ...socialMetadata({
    title: `The Fleet · ${SITE_NAME}`,
    description,
    path: "/fleet",
  }),
};

/** Build-time check so a car can be wired before its photo file lands. */
function photoExists(photo: string) {
  const file = photo.split("?")[0].replace(/^\//, "");
  return existsSync(path.join(process.cwd(), "public", file));
}

const PRIMARY_BTN =
  "h-11 w-full bg-red px-5 font-heading tracking-[0.16em] text-white uppercase hover:bg-red/90";
const SECONDARY_BTN =
  "h-11 w-full border-white/25 bg-transparent px-5 font-heading tracking-[0.16em] text-white uppercase hover:bg-white/10 hover:text-white";

export default function FleetPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
      <p className="font-heading text-xs tracking-[0.28em] text-gold uppercase">
        The Fleet
      </p>
      <h1 className="mt-3 text-4xl font-bold text-white sm:text-5xl">
        Cars you can book
      </h1>

      <ul className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {fleetVehicles.map((vehicle) => {
          const name = vehicleName(vehicle);
          // Buttons come only from data/fleet.ts (listed + links).
          const buttons = bookingButtons(vehicle);
          const hasDirect = buttons.some((b) => b.key === "direct");
          const firstLink = buttons.find((b) => b.kind === "link");
          const photoHref = firstLink?.kind === "link" ? firstLink.href : undefined;
          const photo = !photoExists(vehicle.photo) ? (
            <div
              role="img"
              aria-label={`${vehicle.photoAlt} (photo coming soon)`}
              className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-navy to-navy-mid font-heading text-xs tracking-[0.22em] text-white/40 uppercase"
            >
              Photo coming soon
            </div>
          ) : (
            <Image
              src={vehicle.photo}
              alt={vehicle.photoAlt}
              fill
              sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
              className={
                vehicle.listed
                  ? "object-cover transition-transform duration-300 hover:scale-[1.03]"
                  : "object-cover opacity-60 grayscale"
              }
            />
          );
          return (
            <li key={vehicle.slug}>
              <article className="flex h-full flex-col overflow-hidden rounded-xl bg-navy-mid ring-1 ring-white/10">
                {photoHref ? (
                  <a
                    href={photoHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="relative block aspect-[4/3] overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                  >
                    {photo}
                  </a>
                ) : (
                  <div className="relative block aspect-[4/3] overflow-hidden">
                    {photo}
                    {!vehicle.listed && (
                      <span className="absolute top-3 left-3 rounded-full bg-navy/90 px-3 py-1 font-heading text-[0.7rem] tracking-[0.16em] text-gold uppercase ring-1 ring-gold/60">
                        Currently unavailable
                      </span>
                    )}
                  </div>
                )}
                <div className="flex flex-1 flex-col p-6">
                  <p className="font-heading text-[0.7rem] tracking-[0.22em] text-white/50 uppercase">
                    {vehicleEyebrow(vehicle)}
                  </p>
                  <h2 className="mt-2 text-2xl font-bold text-white">{name}</h2>
                  {/* mb-auto pushes the status / buttons to the card bottom so they
                      line up across a row when a name wraps. */}
                  <p className="mt-2 mb-auto text-base leading-relaxed text-white/70">
                    {vehicle.descriptor}
                  </p>
                  {!vehicle.listed && (
                    <p
                      className="mt-6 flex h-11 w-full items-center justify-center rounded-md border border-white/15 font-heading text-sm tracking-[0.16em] text-white/60 uppercase"
                      data-status="unavailable"
                    >
                      Currently unavailable
                    </p>
                  )}
                  {buttons.map((button, i) => {
                    // Book Direct is primary when present; otherwise the first
                    // platform keeps the existing red style (unchanged look).
                    const primary = hasDirect ? button.primary : i === 0;
                    const spacing = i === 0 ? "mt-6" : "mt-3";
                    if (button.kind === "direct") {
                      return (
                        <BookDirectButton
                          key={button.key}
                          rentalId={button.rentalId}
                          vehicleName={name}
                          label={button.label}
                          className={`${spacing} inline-flex items-center justify-center rounded-lg text-sm font-medium ${PRIMARY_BTN}`}
                        />
                      );
                    }
                    return (
                      <Button
                        key={button.key}
                        asChild
                        variant={primary ? "default" : "outline"}
                        className={`${spacing} ${primary ? PRIMARY_BTN : SECONDARY_BTN}`}
                      >
                        <a
                          href={button.href}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {button.label}
                        </a>
                      </Button>
                    );
                  })}
                </div>
              </article>
            </li>
          );
        })}
      </ul>

      <section className="mt-16 border-t border-white/10 pt-12">
        <p className="text-base leading-relaxed text-white/70">
          Own a car? See{" "}
          <Link href="/plans" className="text-gold hover:underline">
            owner plans
          </Link>{" "}
          or the{" "}
          <Link href="/partners" className="text-gold hover:underline">
            fleet partners
          </Link>{" "}
          page.
        </p>
      </section>
    </div>
  );
}
