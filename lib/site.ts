export const CONTACT_EMAIL_DEFAULT = "panamerica.cars@gmail.com";

export const CONTACT_PHONE_DISPLAY = "(904) 334-3975";
export const CONTACT_PHONE_TEL = "+19043343975";

export function getContactEmail() {
  return (
    process.env.CONTACT_EMAIL?.trim() ||
    process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() ||
    CONTACT_EMAIL_DEFAULT
  );
}

/** Display join for a readonly name list: "A", "A and B", "A, B, and C". */
export function formatNameList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

export const legal = {
  tradeName: "Panamerica Auto Rentals",
  entityName: "Panamerica Auto, LLC",
  docNumber: "L26000295877",
  status: "Active",
  jurisdiction: "Florida LLC",
  filed: "2026-05-27",
  authorizedMembers: ["Chris Volkernick", "Thais Lira"],
  registeredAgent: {
    name: "Registered Agents Inc",
    address: "7901 4th St N Ste 300, St. Petersburg, FL 33702",
  },
  sunbizSearch:
    "https://search.sunbiz.org/Inquiry/corporationsearch/SearchResults?inquiryType=EntityName&searchTerm=PANAMERICA+AUTO",
} as const;

export const turoGuestUrl = "https://turo.com/us/en/drivers/27172979";

/** 15-minute intro call (Google Calendar appointment schedule, organizer Panamerica). */
export const introCallUrl = "https://calendar.app.google/Kpfn3aeKQ2VvZyeQ6";

export const positioning =
  "Fleet management and automotive logistics, specializing in management of assets on Turo and other rideshare platforms.";

export const about = {
  title: "Who we are",
  paragraphs: [
    "We are a small, highly capable team of well-established fleet management experts specializing in all aspects of fleet operations, customer service, logistics, and management. We specialize in everything from day-to-day cleanings and operations to guest communications, vehicle maintenance and upkeep, and site delivery.",
    "We have over a decade of combined experience with fleets of all sizes, ranging from a few vehicles to aggregate fleets of over 100. We have experience across a diverse set of Southeastern markets, including Orlando, Jacksonville, Tampa, St. Pete, Fort Myers, Cape Coral, and Punta Gorda.",
  ],
  markets: [
    "Orlando",
    "Jacksonville",
    "Tampa",
    "St. Pete",
    "Fort Myers",
    "Cape Coral",
    "Punta Gorda",
  ],
  founder: {
    name: "Chris Volkernick",
    bio: [
      "I started in vehicle rentals around 2020. I had run Airbnb properties, and through that I found Turo, which I saw as the car version of Airbnb. I listed one of my own cars with a co-host fleet manager, then went to work for that company on their other cars. Over time I bought my own cars to rotate into their fleet and grew with them as they expanded across several locations. I eventually ran one location on my own with roughly 40 to 50 cars, and at the peak I worked with somewhere between 100 and 150 cars. Along the way I managed cars in Orlando, Jacksonville, Tampa, St. Petersburg, the Fort Myers and Cape Coral area, and Punta Gorda.",
      "I then started working for myself, running my own cars and taking on cars from other owners through Panamerica Auto, LLC. I stay hands-on in all of it: pricing, guest messages, maintenance, cleaning, scheduling, tolls, insurance, and buying vehicles.",
      "Turo was my first work in the car business, and I learned it by doing it. I also hold a computer science degree and have a software development background in web and mobile apps. I'm also experimenting with AI and automation solutions in the business, and I'm exploring branching out into the autonomous vehicle market as it emerges, including the Cybercab.",
    ],
  },
  authorizedMember: {
    name: "Thais Lira",
    bio: [
      "I bring more than three years of experience in customer service and business administration to Panamerica Auto Rentals. I manage and coordinate all aspects of our fleet management, and I provide virtual support to guests and to our team. I've also overseen customer service teams, so I know what it takes to keep service consistent, responsive, and friendly. I'm currently specializing in international relations and governance studies, which helps me with cross-border coordination, international client and vendor relations, and multilingual support. I enjoy making the rental experience simple for guests and dependable for the owners we work with.",
    ],
  },
} as const;

export const services = [
  {
    slug: "fleet-management",
    title: "Fleet management",
    accent: "red" as const,
    summary:
      "Oversight of vehicle assets placed on Turo and other rideshare platforms — readiness, turnover, and day-to-day care.",
    description:
      "We manage vehicle assets so they stay available and in working order for platform use. That covers coordination of upkeep, turnover between trips, and the operational details owners should not have to chase themselves. We do not publish fleet size, utilization rates, or vehicle inventories.",
  },
  {
    slug: "platform-ops",
    title: "Platform ops",
    eyebrow: "Turo & rideshare",
    accent: "blue" as const,
    summary:
      "Hands-on operations for assets listed on Turo and other rideshare platforms — listings, guest-facing workflow, and platform process.",
    description:
      "Platform work is the daily rhythm of keeping listings current and handling the operational side of Turo and similar rideshare marketplaces. Managed cars are on the Fleet page with a Turo booking link. This site does not scrape Turo and does not publish prices, plates, or VINs.",
  },
  {
    slug: "automotive-logistics",
    title: "Automotive logistics",
    accent: "green" as const,
    summary:
      "Movement and coordination of vehicles between service, storage, and platform readiness.",
    description:
      "Logistics is the physical side: getting a vehicle where it needs to be, when it needs to be there, so it can go back on platform or into service. We keep that description honest — no invented lanes, warehouses, or nationwide office map.",
  },
] as const;

export const planAccentBorder = {
  gold: "border-gold",
  red: "border-red",
  blue: "border-royal",
  green: "border-green",
} as const;

export const planAccentBar = {
  gold: "bg-gold",
  red: "bg-red",
  blue: "bg-royal",
  green: "bg-green",
} as const;

/** Public teaser — month-to-month from day one, end-of-next-month notice only. Not extra legal claims. */
export const noLockInTeaser = {
  eyebrow: "No lock-in",
  body: "Agreements are month-to-month from day one, with no minimum term. Either party can end with written notice; it takes effect at the end of the calendar month after the month notice is given.",
} as const;

/** Included on every fleet-management plan. Opportunities stays Coming. */
export const fleetSpotlightIncluded = {
  heading: "Spotlight included",
  body: "Listing on the Panamerica site plus market insights. The Spotlight Opportunities feed ($25) is Coming — not live and not checkoutable until that feed exists.",
} as const;

export const ownerPlans = [
  {
    slug: "spotlight",
    kind: "self-serve" as const,
    category: "Self-serve",
    rung: 1,
    title: "Spotlight",
    accent: "gold" as const,
    summary:
      "You still run day-to-day yourself; we list the car for leads and share fleet/market insights — not fleet management.",
    fee: "Per car / month flat fee",
    details: [
      {
        heading: "Fee",
        body: "Per car / month flat fee. You stay on your own day-to-day operations.",
      },
      {
        heading: "What we do",
        body: "We list the car for leads on the Fleet partners page and, on higher rungs, share anonymized fleet and market insights. This is not fleet management.",
      },
      {
        heading: "What you do",
        body: "You still run day-to-day yourself — bookings, guests, cleaning, and upkeep stay with you.",
      },
    ],
    tiers: [
      {
        price: "$10",
        name: "Listing only",
        description: "Listing on the Fleet partners page.",
        status: "available" as const,
      },
      {
        price: "$15",
        name: "Listing + insights",
        description:
          "Listing plus monthly anonymized fleet insights — earnings, expenses, and profitability-style intel.",
        status: "available" as const,
      },
      {
        price: "$25",
        name: "Listing + insights + opportunity feed",
        description:
          "Listing, insights, and a vehicle-opportunity feed. Shown so the ladder is complete — fulfillment is gated until the feed exists.",
        status: "coming" as const,
      },
    ],
  },
  {
    slug: "standard-management",
    kind: "fleet-management" as const,
    category: "Fleet management",
    rung: 2,
    split: "80/20",
    title: "Standard management",
    accent: "red" as const,
    ownerShare: "80%",
    companyShare: "20%",
    summary:
      "Owner 80% / company 20%. You cover the car payment, insurance, and all maintenance. We run bookings, pricing, cleaning, setup, delivery, and day-to-day rental-platform and fleet operations.",
    details: [
      {
        heading: "Split",
        body: "Owner 80% / company 20%.",
      },
      {
        heading: "Owner pays",
        body: "Car payment, insurance, and all maintenance.",
      },
      {
        heading: "Company provides",
        body: "Bookings, pricing, cleaning, setup, delivery, and day-to-day rental-platform and fleet operations.",
      },
      fleetSpotlightIncluded,
    ],
  },
  {
    slug: "guaranteed-payment",
    kind: "fleet-management" as const,
    category: "Fleet management",
    rung: 3,
    split: "50/50",
    title: "Guaranteed payment + shared OpEx",
    accent: "blue" as const,
    ownerShare: "50%",
    companyShare: "50%",
    summary:
      "After shared expenses, remaining profit splits 50/50. The company guarantees only the owner's half of the monthly car payment, never insurance. Insurance always splits 50/50. Maintenance splits 50/50 up to $500/month total.",
    details: [
      {
        heading: "Profit split",
        body: "After shared expenses, remaining profit splits 50/50.",
      },
      {
        heading: "Car payment",
        body: "Split 50/50 and paid from revenue first. The company guarantees only the owner's half of the car payment: if the owner's share of a month's revenue does not cover it, the company makes up the difference. The guarantee never covers insurance.",
      },
      {
        heading: "Insurance",
        body: "Always split 50/50. The owner pays the owner's half regardless of revenue.",
      },
      {
        heading: "Maintenance",
        body: "Split 50/50 up to $500/month total ($250 each). Amounts above that monthly maximum come out of the owner's share before the profit split is paid.",
      },
      fleetSpotlightIncluded,
    ],
  },
  {
    slug: "owner-exit",
    kind: "fleet-management" as const,
    category: "Fleet management",
    rung: 4,
    split: "20/80",
    title: "Owner exit",
    accent: "green" as const,
    ownerShare: "20%",
    companyShare: "80%",
    summary:
      "Owner 20% / company 80%. The company pays the car payment and insurance in full. Maintenance stays 50/50 within the same $500/month cap until the car is paid off and title transfers to the company.",
    details: [
      {
        heading: "Split",
        body: "Owner 20% / company 80%.",
      },
      {
        heading: "Car payment and insurance",
        body: "The company pays the car payment and insurance in full.",
      },
      {
        heading: "Maintenance",
        body: "Split 50/50 within the $500/month total cap ($250 each).",
      },
      fleetSpotlightIncluded,
      {
        heading: "Term",
        body: "Month-to-month from day one, with no minimum term. Either party can end with written notice, effective at the end of the calendar month after the month notice is given. If not ended sooner, it ends when the car is paid off in full, and ownership and title then transfer to the company.",
      },
    ],
  },
] as const;

export type OwnerPlan = (typeof ownerPlans)[number];

export function isSelfServePlan(
  plan: OwnerPlan
): plan is Extract<OwnerPlan, { kind: "self-serve" }> {
  return plan.kind === "self-serve";
}

export function isFleetManagementPlan(
  plan: OwnerPlan
): plan is Extract<OwnerPlan, { kind: "fleet-management" }> {
  return plan.kind === "fleet-management";
}

export const fleetPartners = [
  {
    slug: "mike-volkernick",
    name: "Mike Volkernick",
    accent: "gold" as const,
    vehicles: [
      "Toyota Corolla 2022",
      "Toyota Corolla 2024",
      "Tesla Model 3 2022",
      "Tesla Model 3 2020",
    ],
    note: null,
    profileStatus: null,
    links: [
      {
        label: "Turo",
        href: "https://turo.com/us/en/drivers/27172979",
      },
    ],
  },
  {
    slug: "vivek",
    name: "Vivekanandhan Vijayachandran",
    shortName: "Vivek",
    accent: "red" as const,
    vehicles: ["Rivian R1S 2023"],
    note: "2023 Rivian R1S owner / partner.",
    profileStatus: "coming" as const,
    links: [],
  },
  {
    slug: "safewheels",
    name: "Alex Djahankhah",
    brand: "SafeWheels Rentals",
    accent: "blue" as const,
    vehicles: [],
    note: "Southwest Florida peer. We have collaborated on listings before, including reciprocal listing.",
    profileStatus: null,
    links: [
      {
        label: "Website",
        href: "https://safewheelsrentalsswfl.com",
      },
      {
        label: "Turo",
        href: "https://turo.com/us/en/drivers/795431",
      },
    ],
  },
  {
    slug: "atlasgo",
    name: "AtlasGO",
    accent: "green" as const,
    vehicles: ["Kia Rio 2016"],
    note: null,
    profileStatus: null,
    links: [],
  },
] as const;

export const nav = [
  { href: "/", label: "Home" },
  { href: "/fleet", label: "Fleet" },
  { href: "/services", label: "Services" },
  { href: "/plans", label: "Plans" },
  { href: "/partners", label: "Partners" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
] as const;

/** NAP web URL. Apex `panamericafleet.com` 308s here. Canonical and Open Graph use the same host (`SITE_URL`). */
export const PUBLIC_WEB_URL = "https://www.panamericafleet.com";

/**
 * Public local listings. Yelp stays off this list until a public URL exists.
 * Footer and /contact only — do not add these to `nav`.
 */
export const localListings = [
  {
    id: "google",
    label: "Google",
    href: "https://www.google.com/maps/place/Panamerica+Auto,+LLC/@26.5528964,-82.0120959,10z/data=!3m1!4b1!4m6!3m5!1s0x2099d2430ae358cd:0xb38032a56810505e!8m2!3d26.5528964!4d-82.0120959!16s%2Fg%2F11zxhw_6qh",
  },
  {
    id: "facebook",
    label: "Facebook",
    href: "https://www.facebook.com/profile.php?id=61594162294583",
  },
] as const;

/** Service-area business. No public street — GBP is Lee County / SWFL. */
export const serviceAreas = ["Lee County, Florida", "Southwest Florida"] as const;

export function localBusinessJsonLd(email: string) {
  return {
    "@context": "https://schema.org",
    "@type": ["Organization", "LocalBusiness"],
    name: legal.entityName,
    telephone: CONTACT_PHONE_TEL,
    email,
    url: PUBLIC_WEB_URL,
    sameAs: localListings.map((item) => item.href),
    areaServed: serviceAreas.map((name) => ({
      "@type": "AdministrativeArea",
      name,
    })),
  };
}

export const cyberfleetNav = {
  href: "/cyberfleet",
  label: "Cyber Fleet",
} as const;
