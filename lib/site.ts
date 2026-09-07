export const CONTACT_EMAIL_DEFAULT = "panamerica.cars@gmail.com";

export function getContactEmail() {
  return (
    process.env.CONTACT_EMAIL?.trim() ||
    process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() ||
    CONTACT_EMAIL_DEFAULT
  );
}

export const legal = {
  tradeName: "Panamerica Auto Rentals",
  entityName: "Panamerica Auto, LLC",
  docNumber: "L26000295877",
  status: "Active",
  jurisdiction: "Florida LLC",
  filed: "2026-05-27",
  authorizedMember: "Thais Lira",
  registeredAgent: {
    name: "Registered Agents Inc",
    address: "7901 4th St N Ste 300, St. Petersburg, FL 33702",
  },
  sunbizSearch:
    "https://search.sunbiz.org/Inquiry/corporationsearch/SearchResults?inquiryType=EntityName&searchTerm=PANAMERICA+AUTO",
} as const;

export const turoGuestUrl = "https://turo.com/us/en/drivers/27172979";

export const positioning =
  "Fleet management and automotive logistics, specializing in management of assets on Turo and other rideshare platforms.";

export const about = {
  title: "Who we are",
  paragraphs: [
    "We are a small but capable team of well-established fleet management experts handling all aspects of fleet operations, customer service, logistics, and management. We handle everything from day-to-day cleanings and operations to guest communications, vehicle maintenance and upkeep, and site delivery.",
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
      "Platform work is the daily rhythm of keeping listings current and handling the operational side of Turo and similar rideshare marketplaces. Guests who want to browse available cars can use our public Turo profile. This site does not scrape Turo and does not list vehicles, prices, plates, or VINs.",
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

export const ownerPlans = [
  {
    slug: "standard-management",
    split: "80/20",
    title: "Standard management",
    accent: "red" as const,
    ownerShare: "80%",
    companyShare: "20%",
    summary:
      "Owner 80% / company 20%. You cover the car payment, insurance, and all maintenance. We run bookings, pricing, cleaning, setup, delivery, and day-to-day Turo and fleet operations.",
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
        body: "Bookings, pricing, cleaning, setup, delivery, and day-to-day Turo and fleet operations.",
      },
    ],
  },
  {
    slug: "guaranteed-payment",
    split: "50/50",
    title: "Guaranteed payment + shared OpEx",
    accent: "blue" as const,
    ownerShare: "50%",
    companyShare: "50%",
    summary:
      "After shared expenses, remaining profit splits 50/50. The company guarantees the owner's monthly car payment. Insurance splits 50/50. Maintenance splits 50/50 up to $500/month total.",
    details: [
      {
        heading: "Profit split",
        body: "After shared expenses, remaining profit splits 50/50.",
      },
      {
        heading: "Car payment",
        body: "The company guarantees the owner's monthly car payment. If the month under-earns, the company makes up the difference. The car payment is not split as an expense line; it is guaranteed.",
      },
      {
        heading: "Insurance",
        body: "Split 50/50.",
      },
      {
        heading: "Maintenance",
        body: "Split 50/50 up to $500/month total ($250 each). Amounts above that monthly maximum come out of the owner's share before the profit split is paid.",
      },
    ],
  },
  {
    slug: "owner-exit",
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
      {
        heading: "Term",
        body: "Continues until the car is paid off in full. Ownership and title then transfer to the company.",
      },
    ],
  },
] as const;

export const nav = [
  { href: "/", label: "Home" },
  { href: "/services", label: "Services" },
  { href: "/plans", label: "Plans" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
] as const;
