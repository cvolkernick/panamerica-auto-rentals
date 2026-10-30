import { getContactEmail, localBusinessJsonLd } from "@/lib/site";

export function LocalBusinessJsonLd() {
  const json = JSON.stringify(localBusinessJsonLd(getContactEmail())).replace(
    /</g,
    "\\u003c",
  );

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}
