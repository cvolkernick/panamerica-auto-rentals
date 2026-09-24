import type { Metadata } from "next";

import {
  CONTACT_EMAIL_DEFAULT,
  CONTACT_PHONE_TEL,
  legal,
  publicListings,
} from "@/lib/site";

export const SITE_URL = "https://panamericafleet.com";
/** Visitor-facing host. The apex 308s here; this is the listings NAP web URL. */
export const PUBLIC_WEB_URL = "https://www.panamericafleet.com";
export const SITE_NAME = "Panamerica Auto Rentals";

export const OG_IMAGE = {
  url: "/og.jpg",
  width: 1200,
  height: 630,
  alt: "Panamerica Auto Rentals logo: silver sports coupe with a red stripe, speed streaks, and white wordmark",
} as const;

export function absoluteUrl(path: string): string {
  if (path === "/") {
    return SITE_URL;
  }
  return `${SITE_URL}${path}`;
}

export function socialMetadata({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  path: string;
}): Pick<Metadata, "alternates" | "openGraph" | "twitter"> {
  const url = absoluteUrl(path);
  return {
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      siteName: SITE_NAME,
      type: "website",
      locale: "en_US",
      images: [OG_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [OG_IMAGE.url],
    },
  };
}

/** Service-area business. No street address — Lee County / SWFL only. */
export function organizationJsonLd(email = CONTACT_EMAIL_DEFAULT) {
  return {
    "@context": "https://schema.org",
    "@type": ["Organization", "LocalBusiness"],
    name: legal.entityName,
    url: PUBLIC_WEB_URL,
    telephone: CONTACT_PHONE_TEL,
    email,
    areaServed: [
      {
        "@type": "AdministrativeArea",
        name: "Lee County, Florida",
      },
      {
        "@type": "AdministrativeArea",
        name: "Southwest Florida",
      },
    ],
    sameAs: publicListings.map((listing) => listing.href),
  };
}
