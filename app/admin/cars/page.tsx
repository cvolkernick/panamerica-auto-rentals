import type { Metadata } from "next";

import { CarAdmin } from "./car-admin";

export const metadata: Metadata = {
  title: "Car",
  robots: "noindex",
};

export const dynamic = "force-static";

export default function CarAdminPage() {
  return <CarAdmin />;
}
