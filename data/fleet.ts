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
  /** Per-vehicle Turo listing URL (not the host profile). */
  turoUrl: string;
};

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
 * V1 fleet listing. Adding a car is a data entry: photo under `public/fleet/`
 * plus a row here.
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
    turoUrl:
      "https://turo.com/us/en/car-rental/united-states/cape-coral-fl/toyota/corolla/3830143",
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
    turoUrl:
      "https://turo.com/us/en/car-rental/united-states/cape-coral-fl/toyota/corolla/3801812",
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
    turoUrl:
      "https://turo.com/us/en/suv-rental/united-states/cape-coral-fl/rivian/r1s/3881079",
  },
  {
    slug: "model-3-2022",
    year: 2022,
    make: "Tesla",
    model: "Model 3",
    descriptor: "Sedan · 5 seats · electric",
    photo: "/fleet/model-3-2022.jpg?v=2",
    photoAlt: "2022 Tesla Model 3 sedan in deep blue with black wheels",
    location: "Cape Coral",
    partner: null,
    turoUrl:
      "https://turo.com/us/en/car-rental/united-states/cape-coral-fl/tesla/model-3/3800020",
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
    turoUrl:
      "https://turo.com/us/en/car-rental/united-states/cape-coral-fl/tesla/model-3/3796859",
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
    turoUrl:
      "https://turo.com/us/en/suv-rental/united-states/punta-gorda-fl/jeep/wrangler/3343831",
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
    turoUrl:
      "https://turo.com/us/en/car-rental/united-states/punta-gorda-fl/kia/k4/3368517",
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
    turoUrl:
      "https://turo.com/us/en/car-rental/united-states/punta-gorda-fl/nissan/sentra/3345686",
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
    turoUrl:
      "https://turo.com/us/en/suv-rental/united-states/punta-gorda-fl/hyundai/santa-fe/2979761",
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
    turoUrl:
      "https://turo.com/us/en/car-rental/united-states/punta-gorda-fl/hyundai/elantra/2990653",
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
    turoUrl:
      "https://turo.com/us/en/suv-rental/united-states/punta-gorda-fl/nissan/pathfinder/3345597",
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
    turoUrl:
      "https://turo.com/us/en/suv-rental/united-states/punta-gorda-fl/chevrolet/traverse/2939523",
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
    turoUrl:
      "https://turo.com/us/en/car-rental/united-states/punta-gorda-fl/kia/telluride/2901165",
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
    turoUrl:
      "https://turo.com/us/en/suv-rental/united-states/punta-gorda-fl/hyundai/kona/2900729",
  },
];

export const safewheelsSiteUrl = "https://safewheelsrentalsswfl.com/";
