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

/** 15-minute intro call (Google Calendar appointment schedule, organizer Panamerica). */
export const introCallUrl = "https://calendar.app.google/Kpfn3aeKQ2VvZyeQ6";

export const positioning =
  "We rent clean, well-maintained vehicles by the day, week, or month to individuals and to gig and rideshare drivers in Fort Myers and Cape Coral. Fleet partner programs for vehicle owners are also available.";

export const about = {
  title: "Who we are",
  paragraphs: [
    "We rent clean, well-maintained vehicles by the day, week, or month to individuals and to gig and rideshare drivers in Fort Myers and Cape Coral. The team handles cleaning, guest communication, maintenance, and delivery so the car is ready when you are.",
    "Fleet partner programs for vehicle owners sit beside that work. We have over a decade of combined experience with fleets of all sizes, from a few vehicles to more than 100, across Orlando, Jacksonville, Tampa, St. Pete, Fort Myers, Cape Coral, and Punta Gorda.",
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
      "I started in vehicle rentals around 2020. I had run Airbnb properties, and through that I found a popular rental platform, which I saw as the car version of Airbnb. I listed one of my own cars with a co-host fleet manager, then went to work for that company on their other cars. Over time I bought my own cars to rotate into their fleet and grew with them as they expanded across several locations. I eventually ran one location on my own with roughly 40 to 50 cars, and at the peak I worked with somewhere between 100 and 150 cars. Along the way I managed cars in Orlando, Jacksonville, Tampa, St. Petersburg, the Fort Myers and Cape Coral area, and Punta Gorda.",
      "I then started working for myself, running my own cars and taking on cars from other owners through Panamerica Auto, LLC. I stay hands-on in all of it: pricing, guest messages, maintenance, cleaning, scheduling, tolls, insurance, and buying vehicles.",
      "Rental platforms were my first work in the car business, and I learned them by doing it. I also hold a computer science degree and have a software development background in web and mobile apps. I'm also experimenting with AI and automation solutions in the business, and I'm exploring branching out into the autonomous vehicle market as it emerges, including the Cybercab.",
    ],
  },
  authorizedMember: {
    name: "Thais Lira",
    bio: [
      "I bring more than three years of experience in customer service and business administration to Panamerica Auto Rentals. I manage and coordinate our client rentals and our work with vehicle owners, and I provide virtual support to guests and to our team. I've also overseen customer service teams, so I know what it takes to keep service consistent, responsive, and friendly. I'm currently specializing in international relations and governance studies, which helps me with cross-border coordination, international client and vendor relations, and multilingual support. I enjoy making the rental experience simple for guests and dependable for the owners we work with.",
    ],
  },
} as const;

export const services = [
  {
    slug: "rentals",
    title: "Rentals",
    accent: "red" as const,
    href: "/fleet",
    linkLabel: "Book Direct",
    summary:
      "Clean, well-maintained vehicles by the day, week, or month for individuals in Fort Myers and Cape Coral.",
    description:
      "Rent a clean, well-maintained vehicle by the day, week, or month. Individuals in Fort Myers and Cape Coral can book direct from the fleet.",
  },
  {
    slug: "gig-driver-rentals",
    title: "Gig driver rentals",
    accent: "blue" as const,
    href: "/drivers",
    linkLabel: "Driver rentals",
    summary:
      "Cars for gig and rideshare drivers in Fort Myers and Cape Coral, by the day, week, or month.",
    description:
      "Gig and rideshare drivers in Fort Myers and Cape Coral can rent a clean, well-maintained vehicle by the day, week, or month. Longer rentals get better rates.",
  },
  {
    slug: "fleet-partners",
    title: "Fleet partners",
    eyebrow: "For vehicle owners",
    accent: "green" as const,
    href: "/partners",
    linkLabel: "Fleet partners",
    summary: "Fleet management for vehicle owners.",
    description:
      "Vehicle owners can place a car in fleet management. We look after readiness and turnover, listings on rental platforms, and getting a vehicle between service and the next trip. We do not publish fleet size, utilization rates, or vehicle inventories, and this site does not scrape rental platforms or publish prices, plates, or VINs.",
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

/**
 * The one public owner plan. Commission is our share of each trip.
 * Rates are public pricing, not a substitute for the written agreement.
 */
export const managementPlan = {
  slug: "management",
  title: "Fleet Management",
  accent: "red" as const,
  summary:
    "We run the car. Commission is our share of each trip, and the rate depends on how long that trip is.",
  tiers: [
    { rate: "20%", label: "Trips under 7 days" },
    { rate: "15%", label: "Trips of 7–21 days" },
    { rate: "10%", label: "Trips over 21 days" },
  ],
  details: [
    {
      heading: "What we do",
      body: "Bookings, pricing, cleaning, setup, delivery, and day-to-day fleet operations.",
    },
  ],
} as const;

export type OwnerPlan = typeof managementPlan;

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
    links: [{ label: "rental platforms" }],
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
      { label: "rental platforms" },
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
  { href: "/management", label: "Fleet Management" },
  { href: "/drivers", label: "Drivers" },
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
    description: positioning,
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
