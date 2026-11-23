import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  bookingButtons,
  dailyRateLabel,
  depositLabel,
  fleetPageVehicles,
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

test("2023 Rivian R1S card is available and shows no price", () => {
  const rivian = vehicle("r1s-2023");
  assert.equal(rivian.year, 2023);
  assert.equal(rivian.make, "Rivian");
  assert.equal(rivian.model, "R1S");
  assert.equal(rivian.listed, true);
  assert.equal(rivian.dailyRateUsd, undefined);
  assert.equal(rivian.depositUsd, undefined);
  assert.equal(dailyRateLabel(rivian.dailyRateUsd), null);
  assert.equal(depositLabel(rivian.depositUsd), null);

  for (const car of fleetVehicles) {
    assert.equal(car.dailyRateUsd, undefined, car.slug);
    assert.equal(car.depositUsd, undefined, car.slug);
    assert.equal(dailyRateLabel(car.dailyRateUsd), null, car.slug);
    assert.equal(depositLabel(car.depositUsd), null, car.slug);
  }

  const bookTuro =
    "https://turo.com/us/en/suv-rental/united-states/cape-coral-fl/rivian/r1s/3881079";
  const widgetUrl =
    "https://widget.wheelbasepro.com/?dealer_id=5262019&store_type=auto&page=listing-details&rental_id=570552";
  assert.equal(rivian.links.turo, bookTuro);
  assert.equal(rivian.links.ride, undefined);
  assert.equal(rivian.links.direct?.wheelbaseRentalId, "570552");
  assert.equal(rivian.links.direct?.enabled, false);
  assert.equal(wheelbaseBookingUrl("570552"), widgetUrl);

  const buttons = bookingButtons(rivian);
  assert.deepEqual(
    buttons.map((button) => button.label),
    ["Book on Turo"]
  );
  assert.equal(buttons[0]?.kind, "link");
  if (buttons[0]?.kind !== "link") return;
  assert.equal(buttons[0].label, "Book on Turo");
  assert.equal(buttons[0].href, bookTuro);
  assert.equal(buttons.some((button) => button.kind === "direct"), false);

  const corollaId = vehicle("corolla-2022").links.direct?.wheelbaseRentalId;
  assert.ok(corollaId);
  assert.equal(corollaId, "564886");
  assert.equal(widgetUrl, wheelbaseBookingUrl(corollaId).replace(corollaId, "570552"));
  assert.equal(source("data/fleet.ts").includes("checkout.wheelbasepro.com"), false);
  assert.equal(source("components/book-direct-button.tsx").includes("wheelbaseBookingUrl(rentalId)"), true);

  const page = source("app/fleet/page.tsx");
  assert.doesNotMatch(page, /dailyRateLabel/);
  assert.doesNotMatch(page, /depositLabel/);
  assert.doesNotMatch(page, /data-daily-rate/);
  assert.doesNotMatch(page, /data-deposit/);
  assert.doesNotMatch(page, /\$\d+/);
  assert.doesNotMatch(page, /\/day/);
  assert.doesNotMatch(page, /deposit/i);
  assert.match(page, /const spacing = i === 0 \? "mt-6" : "mt-3"/);
  assert.match(page, /\{!vehicle\.listed && \([\s\S]*Currently unavailable/);
  assert.equal(page.includes("Currently unavailable"), true);
  assert.match(page, /<BookDirectButton[\s\S]*rentalId=\{button\.rentalId\}/);
  assert.equal(page.includes("checkout.wheelbasepro.com"), false);
});

test("other fleet cards stay unchanged, including both Tesla Model 3s", () => {
  const expected: Record<string, { listed: boolean; labels: string[] }> = {
    "corolla-2022": { listed: true, labels: ["Book Direct", "Book on Turo", "Book on Ride"] },
    "corolla-2024": { listed: true, labels: ["Book Direct", "Book on Turo", "Book on Ride"] },
    "model-3-2022": { listed: true, labels: ["Book Direct", "Book on Turo", "Book on Ride"] },
    "model-3-2020": { listed: false, labels: [] },
    "rio-2016": { listed: true, labels: ["Book Direct", "Book on Mobi", "Book on Upcar"] },
    "soul-2014": { listed: true, labels: ["Book Direct", "Book on Ride"] },
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
    direct: { wheelbaseRentalId: "576075", enabled: true },
    turo: "https://turo.com/us/en/car-rental/united-states/cape-coral-fl/tesla/model-3/3800020",
    ride: "https://www.ride.auto/car-rental/cape-coral_fl/2022_tesla_model-3_576075-listing",
  });
  assert.equal(model3_2022.dailyRateUsd, undefined);
  assert.equal(model3_2022.depositUsd, undefined);
  assert.equal(model3_2022.descriptor, "Sedan · 5 seats · electric");
  assert.equal(model3_2022.photo, "/fleet/model-3-2022.jpg?v=3");

  const model3_2020 = vehicle("model-3-2020");
  assert.equal(model3_2020.listed, false);
  assert.equal(model3_2020.hiddenFromFleet, true);
  assert.deepEqual(bookingButtons(model3_2020), []);
  assert.deepEqual(model3_2020.links, {
    turo: "https://turo.com/us/en/car-rental/united-states/cape-coral-fl/tesla/model-3/3796859",
  });
  assert.equal(model3_2020.descriptor, "Sedan · 5 seats · electric");
  assert.equal(model3_2020.photo, "/fleet/model-3-2020.jpg");
});

test("2020 Model 3 is hidden on /fleet and the 2022 Model 3 stays visible", () => {
  const hidden = vehicle("model-3-2020");
  const visible = vehicle("model-3-2022");
  assert.equal(hidden.year, 2020);
  assert.equal(visible.year, 2022);
  assert.equal(hidden.hiddenFromFleet, true);
  assert.equal(visible.hiddenFromFleet, undefined);
  assert.equal(visible.listed, true);

  const pageCars = fleetPageVehicles();
  assert.equal(pageCars.some((car) => car.slug === "model-3-2020"), false);
  assert.equal(pageCars.some((car) => car.slug === "model-3-2022"), true);
  assert.ok(fleetVehicles.some((car) => car.slug === "model-3-2020"));

  const page = source("app/fleet/page.tsx");
  assert.match(page, /fleetPageVehicles\(\)\.map/);
  assert.equal(page.includes("fleetVehicles.map"), false);
  // Other unlisted cars still use listed: false only; this flag is opt-in.
  const othersHidden = fleetVehicles.filter(
    (car) => car.slug !== "model-3-2020" && car.hiddenFromFleet
  );
  assert.deepEqual(othersHidden.map((car) => car.slug), []);
});

test("2014 Kia Soul card is available with Book Direct and Ride, and shows no price", () => {
  const soul = vehicle("soul-2014");
  assert.equal(soul.year, 2014);
  assert.equal(soul.make, "Kia");
  assert.equal(soul.model, "Soul");
  assert.equal(soul.descriptor, "Hatchback · 5 seats · gas");
  assert.equal(soul.photo, "/fleet/soul-2014.jpg");
  assert.equal(soul.photoAlt, "2014 Kia Soul hatchback in silver");
  assert.equal(soul.location, "Cape Coral");
  assert.equal(soul.partner, null);
  assert.equal(soul.listed, true);
  assert.equal(soul.dailyRateUsd, undefined);
  assert.equal(soul.depositUsd, undefined);
  assert.equal(dailyRateLabel(soul.dailyRateUsd), null);
  assert.equal(depositLabel(soul.depositUsd), null);

  const ride =
    "https://www.ride.auto/car-rental/cape-coral_fl/2014_kia_soul_578826-listing";
  const widgetUrl =
    "https://widget.wheelbasepro.com/?dealer_id=5262019&store_type=auto&page=listing-details&rental_id=578826";
  assert.deepEqual(soul.links, {
    direct: { wheelbaseRentalId: "578826", enabled: true },
    ride,
  });
  assert.equal("turo" in soul.links, false);
  assert.equal(wheelbaseBookingUrl("578826"), widgetUrl);

  const buttons = bookingButtons(soul);
  assert.deepEqual(
    buttons.map((button) => button.label),
    ["Book Direct", "Book on Ride"]
  );
  assert.equal(buttons[0]?.kind, "direct");
  if (buttons[0]?.kind !== "direct") return;
  assert.equal(buttons[0].rentalId, "578826");
  assert.equal(buttons[1]?.kind, "link");
  if (buttons[1]?.kind !== "link") return;
  assert.equal(buttons[1].href, ride);
});
