import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { SITE_NAME, socialMetadata } from "@/lib/seo";
import {
  CONTACT_PHONE_DISPLAY,
  CONTACT_PHONE_TEL,
  getContactEmail,
} from "@/lib/site";

import styles from "./cyberfleet.module.css";

const description =
  "Coming soon. An interest page for peer fleet operators preparing a path from a legacy Turo book toward an autonomous Cybercab network. Not a live offering and not a securities offer.";

export const metadata: Metadata = {
  title: "Cyber Fleet — Coming soon",
  description,
  ...socialMetadata({
    title: `Cyber Fleet — Coming soon · ${SITE_NAME}`,
    description,
    path: "/cyberfleet",
  }),
};

const quote = "If you don’t cannibalize yourself, someone else will.";

const teslaVideos = {
  firstOnPage: { src: "/cyberfleet/tesla-1.mp4" },
  secondOnPage: { src: "/cyberfleet/tesla-2.mp4" },
} as const;

function TeslaClip({ src }: { src: string }) {
  return (
    <figure className={styles.videoFrame}>
      <div className={styles.videoStage}>
        <video
          className={styles.video}
          src={src}
          muted
          autoPlay
          loop
          playsInline
          controls
          preload="metadata"
        >
          Your browser cannot play this video.
        </video>
      </div>
      <figcaption className={styles.videoCredit}>
        Video: Tesla · Credit: Tesla
      </figcaption>
    </figure>
  );
}

export default function CyberfleetPage() {
  const email = getContactEmail();

  return (
    <div className={styles.shell}>
      <div
        className={`${styles.inner} mx-auto flex max-w-3xl flex-col gap-10 px-4 py-14 sm:px-6 sm:py-20`}
      >
        <p className="font-heading text-[0.7rem] tracking-[0.32em] text-white/55 uppercase">
          Panamerica Auto Rentals
        </p>

        <header>
          <p
            className={`${styles.badge} inline-flex rounded-full bg-gold/12 px-3 py-1.5 font-heading text-[0.7rem] tracking-[0.28em] text-gold uppercase`}
          >
            Coming soon
          </p>
          <p className="mt-5 text-lg leading-relaxed text-white/80 sm:text-xl">
            Autonomy is coming for the cars you already run. If you don’t remake
            your own Turo fleet, someone else will.
          </p>
          <h1 className="mt-6 text-4xl leading-[0.95] font-bold text-white sm:text-5xl lg:text-6xl">
            Get your fleet ahead of the autonomy curve.
          </h1>
        </header>

        <TeslaClip src={teslaVideos.secondOnPage.src} />

        <blockquote
          className={`${styles.quote} rounded-xl bg-navy-mid/70 px-6 py-6 sm:px-8 sm:py-8`}
        >
          <p className="font-heading text-2xl leading-snug tracking-[0.06em] text-gold normal-case sm:text-3xl">
            “{quote}”
          </p>
          <footer className="mt-4 font-heading text-xs tracking-[0.22em] text-white/50 uppercase">
            Steve Jobs
          </footer>
        </blockquote>

        <section className={`${styles.glass} rounded-xl px-6 py-6 sm:px-8 sm:py-8`}>
          <p className="font-heading text-[0.7rem] tracking-[0.28em] text-[color:var(--cf-cyan)] uppercase">
            Self-disruption
          </p>
          <p className="mt-4 text-base leading-relaxed text-white/80">
            Steve Jobs put it simply: if you don’t cannibalize yourself, someone
            else will. The same pressure hits every fleet that lives on
            human-driven Turo today. A Cybercab network will remake guest ops,
            utilization, and what “a car in the fleet” even means — and the
            operators who wait for a finished playbook will buy someone else’s.
          </p>
        </section>

        <TeslaClip src={teslaVideos.firstOnPage.src} />

        <section className={`${styles.glass} rounded-xl px-6 py-6 sm:px-8 sm:py-8`}>
          <p className="font-heading text-[0.7rem] tracking-[0.28em] text-[color:var(--cf-cyan)] uppercase">
            What this rung is
          </p>
          <p className="mt-4 text-base leading-relaxed text-white/80">
            Cyber Fleet is the fifth rung on the owner ladder, above Owner Exit:
            a transition path for peer fleet operators and managers who want to
            move a legacy Turo book toward an autonomous Cybercab network when
            Tesla’s pieces are real. You keep earning on what works today. We
            help you prepare the jump. The economics and Tesla implementation
            details stay Coming until they exist.
          </p>
        </section>

        <section className={`${styles.glass} rounded-xl px-6 py-6 sm:px-8 sm:py-8`}>
          <p className="font-heading text-[0.7rem] tracking-[0.28em] text-[color:var(--cf-cyan)] uppercase">
            Honest limits
          </p>
          <p className="mt-4 text-base leading-relaxed text-white/80">
            This is not Tesla. It is not a securities offer, and it is not a
            live Robotaxi product you can check out. Southwest Florida is not a
            live Robotaxi metro yet. If you want in on the waitlist / interest
            list while we build the path, talk to us.
          </p>
        </section>

        <section
          className={`${styles.glass} rounded-xl px-6 py-6 sm:px-8 sm:py-8`}
          aria-label="Interest list"
        >
          <p className="font-heading text-[0.7rem] tracking-[0.28em] text-gold uppercase">
            Talk to us
          </p>
          <p className="mt-3 text-base leading-relaxed text-white/75">
            Coming soon — no checkout, no live offering. Reach us if you want on
            the interest list.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Button
              asChild
              className={`${styles.cta} h-12 bg-gold px-6 font-heading tracking-[0.18em] text-navy uppercase hover:bg-gold/90`}
            >
              <Link href="/contact">Contact</Link>
            </Button>
            <Button
              asChild
              variant="outline"
              className={`${styles.ctaGhost} h-12 border-white/15 bg-transparent px-6 font-heading tracking-[0.18em] text-white uppercase hover:bg-white/10`}
            >
              <a href={`tel:${CONTACT_PHONE_TEL}`}>{CONTACT_PHONE_DISPLAY}</a>
            </Button>
            <Button
              asChild
              variant="outline"
              className={`${styles.ctaGhost} h-12 border-white/15 bg-transparent px-6 font-heading tracking-[0.14em] text-white normal-case hover:bg-white/10`}
            >
              <a href={`mailto:${email}`}>{email}</a>
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
