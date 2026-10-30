import type { Metadata } from "next";

import { ContactForm } from "@/components/contact-form";
import { Button } from "@/components/ui/button";
import { SITE_NAME, socialMetadata } from "@/lib/seo";
import {
  CONTACT_PHONE_DISPLAY,
  CONTACT_PHONE_TEL,
  getContactEmail,
  introCallUrl,
  localListings,
  turoGuestUrl,
} from "@/lib/site";

const description =
  "Write Panamerica Auto Rentals. Messages open in your mail app.";

export const metadata: Metadata = {
  title: "Contact",
  description,
  ...socialMetadata({
    title: `Contact · ${SITE_NAME}`,
    description,
    path: "/contact",
  }),
};

export default function ContactPage() {
  const email = getContactEmail();

  return (
    <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-[1fr_20rem]">
      <div>
        <p className="font-heading text-xs tracking-[0.28em] text-gold uppercase">
          Contact
        </p>
        <h1 className="mt-3 text-4xl font-bold text-white sm:text-5xl">
          Send a note
        </h1>
        <p className="mt-4 max-w-xl text-base leading-relaxed text-white/70">
          Prefer a 15-minute intro call? Pick a time — Google Meet is added after
          you book.
        </p>
        <Button
          asChild
          className="mt-5 h-11 bg-red px-6 font-heading tracking-[0.18em] text-white uppercase hover:bg-red/90"
        >
          <a
            href={introCallUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Schedule an intro call
          </a>
        </Button>
        <div className="mt-8 rounded-xl bg-navy-mid p-5 ring-1 ring-white/10 sm:p-8">
          <ContactForm email={email} />
        </div>
      </div>
      <aside className="rounded-xl bg-navy-mid p-6 ring-1 ring-white/10 lg:self-start">
        <h2 className="text-lg font-bold text-white">Direct</h2>
        <p className="mt-3 text-sm leading-relaxed text-white/70">
          Prefer to skip the form?
        </p>
        <Button
          asChild
          className="mt-4 h-11 w-full bg-red px-6 font-heading tracking-[0.18em] text-white uppercase hover:bg-red/90"
        >
          <a
            href={introCallUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Schedule an intro call
          </a>
        </Button>
        <a
          href={`tel:${CONTACT_PHONE_TEL}`}
          className="mt-3 block text-gold hover:underline"
        >
          {CONTACT_PHONE_DISPLAY}
        </a>
        <a
          href={`mailto:${email}`}
          className="mt-3 block break-all text-gold hover:underline"
        >
          {email}
        </a>
        <p className="mt-6 text-sm leading-relaxed text-white/70">
          Find us on{" "}
          {localListings.map((item, index) => (
            <span key={item.id}>
              {index > 0 ? " and " : null}
              <a
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-gold hover:underline"
              >
                {item.label}
              </a>
            </span>
          ))}
          .
        </p>
        <h2 className="mt-8 text-lg font-bold text-white">Guests</h2>
        <p className="mt-3 text-sm leading-relaxed text-white/70">
          Looking for a car on Turo? Use the public host profile.
        </p>
        <a
          href={turoGuestUrl}
          rel="noopener noreferrer"
          className="mt-3 inline-block font-heading text-sm tracking-[0.16em] text-white uppercase hover:text-gold"
        >
          Turo
        </a>
      </aside>
    </div>
  );
}
