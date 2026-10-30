/**
 * Book Direct (Wheelbase). Helm supplies these per car. When present, the card
 * shows a primary "Book Direct" button first.
 */
export type DirectBooking = {
  /**
   * Wheelbase rental id, e.g. "564886". "Book Direct" opens a dialog that renders
   * <listing-details dealer-id={WHEELBASE_DEALER_ID} rental-id={id}>.
   */
  wheelbaseRentalId: string;
  /**
   * Per-car switch. false keeps the id in the data but shows no Book Direct
   * button for this car (even when BOOK_DIRECT_ENABLED is true).
   */
  enabled: boolean;
};

/** Any extra platform beyond the known ones. Rendered after Ride, in array order. */
export type OtherBookingLink = { label: string; url: string };

/**
 * Per-platform booking links. Leave a platform out (or delete its line) and no
 * button is rendered for it. Never put an empty string here.
 */
export type BookingLinks = {
  direct?: DirectBooking;
  turo?: string;
  mobi?: string;
  upcar?: string;
  ride?: string;
  others?: readonly OtherBookingLink[];
};

export type FleetVehicle = {
  slug: string;
  year: number;
  make: string;
  model: string;
  trim?: string;
  descriptor: string;
  photo: string;
  photoAlt: string;
  location: string;
  /** Partner brand when the car is not Panamerica-managed. */
  partner: string | null;
  /**
   * true = bookable, buttons render from `links`.
   * false = card stays, shows "Currently unavailable", NO booking buttons.
   */
  listed: boolean;
  links: BookingLinks;
};

/**
 * Master switch for Book Direct (Wheelbase). false = no Book Direct buttons
 * anywhere and the Wheelbase widget script is never loaded, even though the
 * `links.direct` ids stay in the data below. Flip to true to turn it on.
 */
export const BOOK_DIRECT_ENABLED = true;

/** Public Wheelbase dealer id (not a secret; it appears in every widget snippet). */
export const WHEELBASE_DEALER_ID = "5262019";

/** Wheelbase-hosted page for one rental: fallback when the embed can't load. */
export const wheelbaseBookingUrl = (rentalId: string) =>
  `https://widget.wheelbasepro.com/?dealer_id=${WHEELBASE_DEALER_ID}&store_type=auto&page=listing-details&rental_id=${rentalId}`;

export type BookingButton =
  | { kind: "direct"; key: "direct"; label: string; rentalId: string; primary: true }
  | { kind: "link"; key: string; label: string; href: string; primary: false };

/**
 * The only place that decides which buttons a car gets, and in what order:
 * Book Direct (primary) → Turo → Mobi → Upcar → Ride → others.
 * Unlisted cars get none.
 */
export function bookingButtons(vehicle: Pick<FleetVehicle, "listed" | "links">): BookingButton[] {
  if (!vehicle.listed) return [];
  const { direct, turo, mobi, upcar, ride, others } = vehicle.links;
  const buttons: BookingButton[] = [];
  if (BOOK_DIRECT_ENABLED && direct?.enabled && direct.wheelbaseRentalId) {
    buttons.push({
      kind: "direct",
      key: "direct",
      label: "Book Direct",
      rentalId: direct.wheelbaseRentalId,
      primary: true,
    });
  }
  const platforms: [string, string, string | undefined][] = [
    ["turo", "Book on Turo", turo],
    ["mobi", "Book on Mobi", mobi],
    ["upcar", "Book on Upcar", upcar],
    ["ride", "Book on Ride", ride],
  ];
  for (const [key, label, href] of platforms) {
    if (href && href.trim()) buttons.push({ kind: "link", key, label, href, primary: false });
  }
  for (const [i, other] of (others ?? []).entries()) {
    if (other.url && other.url.trim() && other.label.trim()) {
      buttons.push({
        kind: "link",
        key: `other-${i}`,
        label: other.label,
        href: other.url,
        primary: false,
      });
    }
  }
  return buttons;
}

export function vehicleName(
  vehicle: Pick<FleetVehicle, "year" | "make" | "model" | "trim">
) {
  const base = `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
  return vehicle.trim ? `${base} ${vehicle.trim}` : base;
}

export function vehicleEyebrow(vehicle: Pick<FleetVehicle, "location" | "partner">) {
  return vehicle.partner
    ? `${vehicle.location} · ${vehicle.partner}`
    : vehicle.location;
}

/**
 * Fleet listing. Adding a car is a data entry: photo under `public/fleet/`
 * plus a row here.
 *
 * To take a car off the site temporarily: set `listed: false` (card stays,
 * shows "Currently unavailable", no buttons). To add a platform: add e.g.
 * `mobi: "https://..."` inside `links`. Book Direct: add
 * `direct: { wheelbaseRentalId: "564886", enabled: true }` inside `links`
 * (`enabled: false` hides the button but keeps the id).
 */
export const fleetVehicles: readonly FleetVehicle[] = [
  {
    slug: "corolla-2022",
    year: 2022,
    make: "Toyota",
    model: "Corolla",
    descriptor: "Sedan · 5 seats · gas",
    photo: "/fleet/corolla-2022.jpg",
    photoAlt: "2022 Toyota Corolla sedan in silver",
    location: "Cape Coral",
    partner: null,
    listed: true,
    links: {
      direct: { wheelbaseRentalId: "564886", enabled: true },
      turo: "https://turo.com/us/en/car-rental/united-states/cape-coral-fl/toyota/corolla/3830143",
      ride: "https://www.ride.auto/car-rental/cape-coral_fl/2022_toyota_corolla_564886-listing",
    },
  },
  {
    slug: "corolla-2024",
    year: 2024,
    make: "Toyota",
    model: "Corolla",
    descriptor: "Sedan · 5 seats · gas",
    photo: "/fleet/corolla-2024.jpg",
    photoAlt: "2024 Toyota Corolla sedan in dark gray",
    location: "Cape Coral",
    partner: null,
    listed: true,
    links: {
      direct: { wheelbaseRentalId: "564891", enabled: true },
      turo: "https://turo.com/us/en/car-rental/united-states/cape-coral-fl/toyota/corolla/3801812",
      ride: "https://www.ride.auto/car-rental/cape-coral_fl/2024_toyota_corolla_564891-listing",
    },
  },
  {
    slug: "r1s-2023",
    year: 2023,
    make: "Rivian",
    model: "R1S",
    descriptor: "SUV · 7 seats · electric AWD",
    photo: "/fleet/r1s-2023.jpg",
    photoAlt: "2023 Rivian R1S SUV in yellow",
    location: "Cape Coral",
    partner: null,
    listed: false,
    links: {
      turo: "https://turo.com/us/en/suv-rental/united-states/cape-coral-fl/rivian/r1s/3881079",
    },
  },
  {
    slug: "model-3-2022",
    year: 2022,
    make: "Tesla",
    model: "Model 3",
    descriptor: "Sedan · 5 seats · electric",
    photo: "/fleet/model-3-2022.jpg?v=3",
    photoAlt: "2022 Tesla Model 3 sedan in deep blue with black wheels",
    location: "Cape Coral",
    partner: null,
    listed: true,
    links: {
      direct: { wheelbaseRentalId: "564896", enabled: false },
      turo: "https://turo.com/us/en/car-rental/united-states/cape-coral-fl/tesla/model-3/3800020",
      // 2026-10-24 off: Ride listing 404 until insurance sorted (Helm)
      // ride: "https://www.ride.auto/car-rental/cape-coral_fl/2022_tesla_model-3_564896-listing",
    },
  },
  {
    slug: "model-3-2020",
    year: 2020,
    make: "Tesla",
    model: "Model 3",
    descriptor: "Sedan · 5 seats · electric",
    photo: "/fleet/model-3-2020.jpg",
    photoAlt: "2020 Tesla Model 3 sedan in white",
    location: "Cape Coral",
    partner: null,
    listed: false,
    links: {
      turo: "https://turo.com/us/en/car-rental/united-states/cape-coral-fl/tesla/model-3/3796859",
    },
  },
  {
    slug: "rio-2016",
    year: 2016,
    make: "Kia",
    model: "Rio",
    trim: "LX",
    descriptor: "Sedan · 5 seats · gas",
    photo: "/fleet/rio-2016.jpg",
    photoAlt: "2016 Kia Rio LX sedan in blue-gray",
    location: "Cape Coral",
    partner: null,
    listed: true,
    links: {
      direct: { wheelbaseRentalId: "571805", enabled: true },
      mobi: "https://drivemobi.com/search/cars/2016-kia-rio-1913",
      upcar: "https://www.upcar.ai/car/104970",
      // Ride is off for the Rio for now. To turn it on, uncomment this line:
      // ride: "https://www.ride.auto/car-rental/cape-coral_fl/2016_kia_rio_571805-listing",
    },
  },
  {
    slug: "wrangler-2025",
    year: 2025,
    make: "Jeep",
    model: "Wrangler",
    trim: "Rubicon",
    descriptor: "SUV · open-air · 4–5 seats",
    photo: "/fleet/wrangler-2025.jpg",
    photoAlt: "2025 Jeep Wrangler Rubicon",
    location: "Punta Gorda",
    partner: "SafeWheels",
    listed: true,
    links: {
      turo: "https://turo.com/us/en/suv-rental/united-states/punta-gorda-fl/jeep/wrangler/3343831",
    },
  },
  {
    slug: "k4-2025",
    year: 2025,
    make: "Kia",
    model: "K4",
    trim: "LXS",
    descriptor: "Sedan · 5 seats",
    photo: "/fleet/k4-2025.jpg",
    photoAlt: "2025 Kia K4 LXS",
    location: "Punta Gorda",
    partner: "SafeWheels",
    listed: true,
    links: {
      turo: "https://turo.com/us/en/car-rental/united-states/punta-gorda-fl/kia/k4/3368517",
    },
  },
  {
    slug: "sentra-2025",
    year: 2025,
    make: "Nissan",
    model: "Sentra",
    trim: "SV",
    descriptor: "Sedan · 5 seats",
    photo: "/fleet/sentra-2025.jpg",
    photoAlt: "2025 Nissan Sentra SV",
    location: "Punta Gorda",
    partner: "SafeWheels",
    listed: true,
    links: {
      turo: "https://turo.com/us/en/car-rental/united-states/punta-gorda-fl/nissan/sentra/3345686",
    },
  },
  {
    slug: "santa-fe-2025",
    year: 2025,
    make: "Hyundai",
    model: "Santa Fe",
    trim: "SEL",
    descriptor: "SUV · 5 seats",
    photo: "/fleet/santa-fe-2025.jpg",
    photoAlt: "2025 Hyundai Santa Fe SEL",
    location: "Punta Gorda",
    partner: "SafeWheels",
    listed: true,
    links: {
      turo: "https://turo.com/us/en/suv-rental/united-states/punta-gorda-fl/hyundai/santa-fe/2979761",
    },
  },
  {
    slug: "elantra-2024",
    year: 2024,
    make: "Hyundai",
    model: "Elantra",
    trim: "SEL",
    descriptor: "Sedan · 5 seats",
    photo: "/fleet/elantra-2024.jpg",
    photoAlt: "2024 Hyundai Elantra SEL",
    location: "Punta Gorda",
    partner: "SafeWheels",
    listed: true,
    links: {
      turo: "https://turo.com/us/en/car-rental/united-states/punta-gorda-fl/hyundai/elantra/2990653",
    },
  },
  {
    slug: "pathfinder-2025",
    year: 2025,
    make: "Nissan",
    model: "Pathfinder",
    trim: "Platinum",
    descriptor: "SUV · 7 seats",
    photo: "/fleet/pathfinder-2025.jpg",
    photoAlt: "2025 Nissan Pathfinder Platinum",
    location: "Punta Gorda",
    partner: "SafeWheels",
    listed: true,
    links: {
      turo: "https://turo.com/us/en/suv-rental/united-states/punta-gorda-fl/nissan/pathfinder/3345597",
    },
  },
  {
    slug: "traverse-2019",
    year: 2019,
    make: "Chevrolet",
    model: "Traverse",
    trim: "Premier",
    descriptor: "SUV · 7–8 seats",
    photo: "/fleet/traverse-2019.jpg",
    photoAlt: "2019 Chevrolet Traverse Premier",
    location: "Punta Gorda",
    partner: "SafeWheels",
    listed: true,
    links: {
      turo: "https://turo.com/us/en/suv-rental/united-states/punta-gorda-fl/chevrolet/traverse/2939523",
    },
  },
  {
    slug: "telluride-2021",
    year: 2021,
    make: "Kia",
    model: "Telluride",
    trim: "LX",
    descriptor: "SUV · 7–8 seats",
    photo: "/fleet/telluride-2021.jpg",
    photoAlt: "2021 Kia Telluride LX",
    location: "Punta Gorda",
    partner: "SafeWheels",
    listed: true,
    links: {
      turo: "https://turo.com/us/en/car-rental/united-states/punta-gorda-fl/kia/telluride/2901165",
    },
  },
  {
    slug: "kona-2021",
    year: 2021,
    make: "Hyundai",
    model: "Kona",
    trim: "SE",
    descriptor: "Compact SUV · 5 seats",
    photo: "/fleet/kona-2021.jpg",
    photoAlt: "2021 Hyundai Kona SE",
    location: "Punta Gorda",
    partner: "SafeWheels",
    listed: true,
    links: {
      turo: "https://turo.com/us/en/suv-rental/united-states/punta-gorda-fl/hyundai/kona/2900729",
    },
  },
];

export const safewheelsSiteUrl = "https://safewheelsrentalsswfl.com/";
