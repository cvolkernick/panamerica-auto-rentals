import type { Metadata } from "next";

import { ContactForm } from "@/components/contact-form";
import { getContactEmail, turoGuestUrl } from "@/lib/site";

export const metadata: Metadata = {
  title: "Contact",
  description: "Write Panamerica Auto Rentals. Messages open in your mail app.",
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
        <p className="mt-5 max-w-xl text-lg leading-relaxed text-white/75">
          Name, email, and a message. Send opens your mail app addressed to{" "}
          <a href={`mailto:${email}`} className="text-gold hover:underline">
            {email}
          </a>
          . There is no booking form and no phone number on this site.
        </p>
        <div className="mt-8 rounded-xl bg-navy-mid p-5 ring-1 ring-white/10 sm:p-8">
          <ContactForm email={email} />
        </div>
      </div>
      <aside className="rounded-xl bg-navy-mid p-6 ring-1 ring-white/10 lg:self-start">
        <h2 className="text-lg font-bold text-white">Direct</h2>
        <p className="mt-3 text-sm leading-relaxed text-white/70">
          Prefer to skip the form?
        </p>
        <a
          href={`mailto:${email}`}
          className="mt-3 block break-all text-gold hover:underline"
        >
          {email}
        </a>
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
