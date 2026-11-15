import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  bookingButtons,
  dailyRateLabel,
  depositLabel,
  fleetVehicles,
  wheelbaseBookingUrl,
  type FleetVehicle,
} from "../../data/fleet";

function source(path: string): string {
  return readFileSync(path, "utf8");
}

function vehicle(slug: string): FleetVehicle {
  const found = fleetVehicles.find((car) => car.slug === slug);
  assert.ok(found, slug);
  return found;
}

test("2023 Rivian R1S card is available at $89/day with no deposit", () => {
  const rivian = vehicle("r1s-2023");
  assert.equal(rivian.year, 2023);
  assert.equal(rivian.make, "Rivian");
  assert.equal(rivian.model, "R1S");
  assert.equal(rivian.listed, true);
  assert.equal(rivian.dailyRateUsd, 89);
  assert.equal(rivian.depositUsd, 0);
  assert.equal(dailyRateLabel(rivian.dailyRateUsd), "$89/day");
  assert.equal(depositLabel(rivian.depositUsd), null);
  assert.equal(depositLabel(undefined), null);
  assert.equal(depositLabel(500), "$500 deposit");

  const bookTuro =
    "https://turo.com/us/en/suv-rental/united-states/cape-coral-fl/rivian/r1s/3881079";
  const widgetUrl =
    "https://widget.wheelbasepro.com/?dealer_id=5262019&store_type=auto&page=listing-details&rental_id=570552";
  assert.equal(rivian.links.turo, bookTuro);
  assert.equal(rivian.links.ride, undefined);
  assert.equal(rivian.links.direct?.wheelbaseRentalId, "570552");
  assert.equal(rivian.links.direct?.enabled, true);

  const buttons = bookingButtons(rivian);
  assert.equal(buttons[0]?.kind, "direct");
  assert.equal(buttons[1]?.kind, "link");
  if (buttons[0]?.kind !== "direct" || buttons[1]?.kind !== "link") return;
  assert.equal(buttons[0].rentalId, "570552");
  assert.equal(buttons[0].label, "Book Direct");
  assert.equal(wheelbaseBookingUrl(buttons[0].rentalId), widgetUrl);
  assert.equal(buttons[1].label, "Book on Turo");
  assert.equal(buttons[1].href, bookTuro);
  assert.equal(buttons.length, 2);

  const corollaId = vehicle("corolla-2022").links.direct?.wheelbaseRentalId;
  assert.ok(corollaId);
  assert.equal(corollaId, "564886");
  assert.equal(widgetUrl, wheelbaseBookingUrl(corollaId).replace(corollaId, "570552"));
  assert.equal(source("data/fleet.ts").includes("checkout.wheelbasepro.com"), false);
  assert.equal(source("components/book-direct-button.tsx").includes("wheelbaseBookingUrl(rentalId)"), true);

  const page = source("app/fleet/page.tsx");
  assert.match(page, /dailyRateLabel\(vehicle\.dailyRateUsd\)/);
  assert.match(page, /depositLabel\(vehicle\.depositUsd\)/);
  assert.match(page, /data-daily-rate/);
  assert.match(page, /data-deposit/);
  assert.match(page, /\{rate \? \(/);
  assert.match(page, /\{deposit \? \(/);
  assert.match(page, /\{!vehicle\.listed && \([\s\S]*Currently unavailable/);
  assert.equal(page.includes("Currently unavailable"), true);
  assert.match(page, /<BookDirectButton[\s\S]*rentalId=\{button\.rentalId\}/);
  assert.equal(page.includes("checkout.wheelbasepro.com"), false);
});

test("other fleet cards stay unchanged, including both Tesla Model 3s", () => {
  const expected: Record<string, { listed: boolean; labels: string[] }> = {
    "corolla-2022": { listed: true, labels: ["Book Direct", "Book on Turo", "Book on Ride"] },
    "corolla-2024": { listed: true, labels: ["Book Direct", "Book on Turo", "Book on Ride"] },
    "model-3-2022": { listed: true, labels: ["Book on Turo"] },
    "model-3-2020": { listed: false, labels: [] },
    "rio-2016": { listed: true, labels: ["Book Direct", "Book on Mobi", "Book on Upcar"] },
    "wrangler-2025": { listed: true, labels: ["Book on Turo"] },
    "k4-2025": { listed: true, labels: ["Book on Turo"] },
    "sentra-2025": { listed: true, labels: ["Book on Turo"] },
    "santa-fe-2025": { listed: true, labels: ["Book on Turo"] },
    "elantra-2024": { listed: true, labels: ["Book on Turo"] },
    "pathfinder-2025": { listed: true, labels: ["Book on Turo"] },
    "traverse-2019": { listed: true, labels: ["Book on Turo"] },
    "telluride-2021": { listed: true, labels: ["Book on Turo"] },
    "kona-2021": { listed: true, labels: ["Book on Turo"] },
  };

  const others = fleetVehicles.filter((car) => car.slug !== "r1s-2023");
  assert.deepEqual(
    others.map((car) => car.slug),
    Object.keys(expected)
  );

  for (const car of others) {
    const want = expected[car.slug];
    assert.ok(want, car.slug);
    assert.equal(car.listed, want.listed, car.slug);
    assert.equal(car.dailyRateUsd, undefined, car.slug);
    assert.equal(car.depositUsd, undefined, car.slug);
    assert.equal(dailyRateLabel(car.dailyRateUsd), null, car.slug);
    assert.equal(depositLabel(car.depositUsd), null, car.slug);
    assert.deepEqual(
      bookingButtons(car).map((button) => button.label),
      want.labels,
      car.slug
    );
  }

  const model3_2022 = vehicle("model-3-2022");
  assert.deepEqual(model3_2022.links, {
    direct: { wheelbaseRentalId: "564896", enabled: false },
    turo: "https://turo.com/us/en/car-rental/united-states/cape-coral-fl/tesla/model-3/3800020",
  });
  assert.equal(model3_2022.descriptor, "Sedan · 5 seats · electric");
  assert.equal(model3_2022.photo, "/fleet/model-3-2022.jpg?v=3");

  const model3_2020 = vehicle("model-3-2020");
  assert.equal(model3_2020.listed, false);
  assert.deepEqual(bookingButtons(model3_2020), []);
  assert.deepEqual(model3_2020.links, {
    turo: "https://turo.com/us/en/car-rental/united-states/cape-coral-fl/tesla/model-3/3796859",
  });
  assert.equal(model3_2020.descriptor, "Sedan · 5 seats · electric");
  assert.equal(model3_2020.photo, "/fleet/model-3-2020.jpg");
});
