import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  agreementBySlug,
  agreementPdfHref,
  planAgreements,
  planDisclaimer,
  planDraftBanner,
} from "@/lib/agreements";
import { SITE_NAME, socialMetadata } from "@/lib/seo";
import { getContactEmail } from "@/lib/site";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return planAgreements.map((doc) => ({ slug: doc.slug }));
}

export const dynamicParams = false;

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const doc = agreementBySlug(slug);
  if (!doc) {
    return { title: "Agreement" };
  }
  const description = `${doc.title} for ${SITE_NAME}. ${planDisclaimer}`;
  return {
    title: doc.title,
    description,
    ...socialMetadata({
      title: `${doc.title} · ${SITE_NAME}`,
      description,
      path: `/plans/${doc.slug}`,
    }),
  };
}

export default async function PlanAgreementPage({ params }: PageProps) {
  const { slug } = await params;
  const doc = agreementBySlug(slug);
  if (!doc) {
    notFound();
  }
  const email = getContactEmail();
  const pdfHref = agreementPdfHref(doc);
  const isDraft = doc.status !== "final";

  return (
    <div className="mx-auto w-full min-w-0 max-w-3xl px-4 py-14 sm:px-6 sm:py-20">
      <p className="font-heading text-xs tracking-[0.28em] text-gold uppercase">
        Owner plans
      </p>
      <h1 className="mt-3 w-full max-w-full text-base font-bold leading-snug tracking-normal text-balance wrap-anywhere text-white sm:text-4xl sm:leading-tight sm:tracking-[0.12em] md:text-5xl">
        {doc.title}
      </h1>
      <p className="mt-3 text-base leading-relaxed text-white/65">
        {doc.subtitle}
      </p>

      {isDraft ? (
        <aside
          className="mt-8 rounded-xl border border-red/40 bg-red/10 px-5 py-4 ring-1 ring-red/20 sm:px-6"
          role="status"
        >
          <p className="font-heading text-[0.7rem] tracking-[0.22em] text-gold uppercase">
            Draft
          </p>
          <p className="mt-2 text-sm leading-relaxed wrap-anywhere text-white/80">
            {planDraftBanner}
          </p>
        </aside>
      ) : null}

      <div className="mt-8 flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap">
        <Button
          asChild
          className="h-11 w-full bg-gold px-5 font-heading tracking-[0.16em] text-navy uppercase hover:bg-gold/90 sm:w-auto"
        >
          <a href={pdfHref} download={doc.pdfFile}>
            Download PDF
          </a>
        </Button>
        <Button
          asChild
          variant="outline"
          className="h-11 w-full border-white/20 bg-transparent px-5 font-heading tracking-[0.16em] text-white uppercase hover:bg-white/10 sm:w-auto"
        >
          <a href={pdfHref} target="_blank" rel="noreferrer">
            Open PDF
          </a>
        </Button>
        <Button
          asChild
          variant="ghost"
          className="h-11 w-full px-5 font-heading tracking-[0.16em] text-white/70 uppercase hover:text-white sm:w-auto"
        >
          <Link href={`/plans#${doc.slug}`}>Back to plans</Link>
        </Button>
      </div>

      <article className="mt-10 w-full min-w-0 space-y-5 text-base leading-relaxed wrap-anywhere text-white/80">
        {doc.paragraphs.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </article>

      <p className="mt-10 text-sm leading-relaxed text-white/55">
        {planDisclaimer} Questions:{" "}
        <a href={`mailto:${email}`} className="text-gold hover:underline">
          {email}
        </a>
        .
      </p>
    </div>
  );
}
