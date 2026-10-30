import Link from "next/link";

import {
  agreementForPlan,
  agreementHref,
  agreementPdfHref,
  exhibitA,
  exhibitAPdfHref,
} from "@/lib/agreements";
import type { OwnerPlan } from "@/lib/site";

export function PlanAgreementLinks({ plan }: { plan: OwnerPlan }) {
  const agreement = agreementForPlan(plan);

  return (
    <p className="mt-6 flex min-w-0 flex-col items-start gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4">
      <Link
        href={agreementHref(plan.slug)}
        className="font-heading text-sm tracking-[0.16em] text-gold uppercase hover:underline"
      >
        Review the agreement
      </Link>
      {agreement.status !== "final" ? (
        <span className="rounded-full bg-gold/15 px-2.5 py-1 font-heading text-[0.65rem] tracking-[0.18em] text-gold uppercase">
          Draft
        </span>
      ) : null}
      <a
        href={agreementPdfHref(agreement)}
        download={agreement.pdfFile}
        className="font-heading text-sm tracking-[0.16em] text-white/55 uppercase hover:text-white hover:underline"
      >
        Download PDF
      </a>
      <a
        href={exhibitAPdfHref()}
        target="_blank"
        rel="noreferrer"
        className="font-heading text-sm tracking-[0.16em] text-white/55 uppercase hover:text-white hover:underline"
      >
        {exhibitA.title}
      </a>
    </p>
  );
}
