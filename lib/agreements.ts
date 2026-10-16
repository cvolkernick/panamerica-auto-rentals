import agreementsData from "@/data/agreements.json";
import { ownerPlans, type OwnerPlan } from "@/lib/site";

export type AgreementStatus = "draft" | "final";

export type PlanAgreement = {
  slug: string;
  title: string;
  subtitle: string;
  pdfFile: string;
  status: AgreementStatus;
  paragraphs: string[];
};

export const planDisclaimer = agreementsData.disclaimer;
export const planDraftBanner = agreementsData.draftBanner;

export const planAgreements = agreementsData.documents as PlanAgreement[];

const agreementsBySlug = new Map(
  planAgreements.map((doc) => [doc.slug, doc] as const)
);

for (const plan of ownerPlans) {
  if (!agreementsBySlug.has(plan.slug)) {
    throw new Error(`missing plan agreement for ${plan.slug}`);
  }
}

export function agreementForPlan(plan: OwnerPlan): PlanAgreement {
  const doc = agreementsBySlug.get(plan.slug);
  if (!doc) {
    throw new Error(`missing plan agreement for ${plan.slug}`);
  }
  return doc;
}

export function agreementBySlug(slug: string): PlanAgreement | undefined {
  return agreementsBySlug.get(slug);
}

export function agreementHref(slug: string): string {
  return `/plans/${slug}`;
}

export function agreementPdfHref(doc: PlanAgreement): string {
  return `/plans/${doc.pdfFile}`;
}
