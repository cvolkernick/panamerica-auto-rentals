import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { fleetVehicles, vehicleEyebrow, vehicleName } from "@/data/fleet";
import { SITE_NAME, socialMetadata } from "@/lib/seo";

const description =
  "Fourteen cars you can book on Turo — Panamerica-managed in Cape Coral and SafeWheels in Punta Gorda.";

export const metadata: Metadata = {
  title: "The Fleet",
  description,
  ...socialMetadata({
    title: `The Fleet · ${SITE_NAME}`,
    description,
    path: "/fleet",
  }),
};

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
          return (
            <li key={vehicle.slug}>
              <article className="flex h-full flex-col overflow-hidden rounded-xl bg-navy-mid ring-1 ring-white/10">
                <a
                  href={vehicle.turoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="relative block aspect-[4/3] overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                >
                  <Image
                    src={vehicle.photo}
                    alt={vehicle.photoAlt}
                    fill
                    sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                    className="object-cover transition-transform duration-300 hover:scale-[1.03]"
                  />
                </a>
                <div className="flex flex-1 flex-col p-6">
                  <p className="font-heading text-[0.7rem] tracking-[0.22em] text-white/50 uppercase">
                    {vehicleEyebrow(vehicle)}
                  </p>
                  <h2 className="mt-2 text-2xl font-bold text-white">{name}</h2>
                  <p className="mt-2 text-base leading-relaxed text-white/70">
                    {vehicle.descriptor}
                  </p>
                  <Button
                    asChild
                    className="mt-6 h-11 w-full bg-red px-5 font-heading tracking-[0.16em] text-white uppercase hover:bg-red/90"
                  >
                    <a
                      href={vehicle.turoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Book on Turo
                    </a>
                  </Button>
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
