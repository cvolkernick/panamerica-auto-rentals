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

export const nav = [
  { href: "/", label: "Home" },
  { href: "/services", label: "Services" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
] as const;
