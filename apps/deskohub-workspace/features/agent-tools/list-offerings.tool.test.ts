import "@/shared/testing/workspace-test-env";
import { describe, expect, test } from "bun:test";
import { Effect, type Schema } from "effect";
import { m } from "@/features/i18n";
import type { ListOfferingsResult } from "./list-offerings.schema";

const { makeAgentToolTestServices, workspaceDateFromToday } = await import(
  "./agent-tools.test-utils"
);
const { listOfferingsTool } = await import("./list-offerings.tool");

const listOfferings = (
  args: Schema.Json,
  services = makeAgentToolTestServices()
) =>
  listOfferingsTool
    .call(args)
    .pipe(
      Effect.provide(services.layer),
      Effect.runPromise
    ) as Promise<ListOfferingsResult>;

const czk = (amount: number) => ({ amount, currency: "CZK" });

describe("list_offerings", () => {
  test("lists every product at its catalog and advertised price with its reservation page", async () => {
    const services = makeAgentToolTestServices();
    const result = await listOfferings({}, services);

    expect(result.offerings).toEqual([
      expect.objectContaining({
        family: "cowork",
        tier: "open-space",
        name: "Open Space",
        price: czk(290),
        price_unit: "day",
        advertised_price: czk(290),
        discount: czk(0),
        usage: "Usable from midnight until 17:00 on the reserved day.",
        add_ons: [
          {
            id: "coffee",
            name: "Coffee",
            price: czk(50),
            price_unit: "day",
            included: false,
          },
        ],
        reservation_url:
          "http://deskohub.test/reservation/cowork?entryTier=open-space",
      }),
      expect.objectContaining({
        family: "cowork",
        tier: "reserved-desk",
        price: czk(410),
        advertised_price: czk(410),
        add_ons: [
          expect.objectContaining({
            id: "coffee",
            price: czk(0),
            included: true,
          }),
          expect.objectContaining({
            id: "workstation",
            price: czk(120),
            included: false,
            options: expect.arrayContaining([
              expect.objectContaining({ id: "2x27-qhd" }),
            ]),
          }),
        ],
      }),
      expect.objectContaining({
        family: "meeting-room",
        duration: "hour:1",
        duration_label: "1 hour",
        price: czk(350),
        price_unit: "booking",
        advertised_price: czk(350),
        discount: czk(0),
        reservation_url:
          "http://deskohub.test/reservation/meeting-room?duration=hour%3A1",
      }),
      expect.objectContaining({ duration: "hour:4", price: czk(980) }),
      expect.objectContaining({ duration: "day:1", price: czk(1820) }),
      expect.objectContaining({
        family: "office",
        price: czk(530),
        seat_price: czk(315),
        advertised_price: czk(845),
        discount: czk(0),
        max_seats: 6,
        max_duration_hours: 672,
        reservation_url: "http://deskohub.test/reservation/office",
      }),
    ]);
    expect(result.advertised_on).toBe(workspaceDateFromToday(0));
    expect(result.business).toEqual({
      name: "Deskohub Workspace",
      address: "Turnovská 430/10, 180 00 Praha 8",
      opening_hours:
        "The space is open 24/7. Open Space desks are usable until 17:00.",
      booking: m.agentToolBookingHandoff({}, { locale: "en-US" }),
    });
    expect(services.snapshotReads).toEqual(["tables"]);
    expect(services.dotyposRequests).toEqual([]);
  });

  test("advertises today's public sale beside the regular price", async () => {
    const services = makeAgentToolTestServices({ saleBasisPoints: 5000 });
    const result = await listOfferings({}, services);
    const byName = (family: string, key?: string) =>
      result.offerings.find(
        (offering) =>
          offering.family === family &&
          (key === undefined ||
            offering.tier === key ||
            offering.duration === key)
      );

    expect(byName("cowork", "open-space")).toMatchObject({
      price: czk(290),
      advertised_price: czk(145),
      discount: czk(145),
      add_ons: [expect.objectContaining({ id: "coffee", price: czk(50) })],
    });
    expect(byName("cowork", "reserved-desk")).toMatchObject({
      price: czk(410),
      advertised_price: czk(205),
    });
    expect(byName("meeting-room", "day:1")).toMatchObject({
      price: czk(1820),
      advertised_price: czk(910),
    });
    expect(byName("office")).toMatchObject({
      price: czk(530),
      seat_price: czk(315),
      advertised_price: czk(422.5),
      discount: czk(422.5),
    });
    expect(services.snapshotReads).toEqual(["tables"]);
    expect(services.dotyposRequests).toEqual([]);
  });

  test("names products and hours in Czech", async () => {
    const result = await listOfferings({ locale: "cs-CZ" });

    expect(result.business.opening_hours).toBe(
      "Prostor je otevřený nonstop. Místa v Open Space lze využívat do 17:00."
    );
    expect(result.offerings[0]).toMatchObject({
      usage: "K dispozici od půlnoci do 17:00 v den rezervace.",
      add_ons: [{ name: m.reservationCoffeeLabel({}, { locale: "cs-CZ" }) }],
    });
    expect(result.offerings[2]).toMatchObject({
      name: m.reservationTierMeetingRoomTitle({}, { locale: "cs-CZ" }),
      duration_label: m.reservationMeetingRoomDurationHours(
        { count: 1 },
        { locale: "cs-CZ" }
      ),
    });
  });

  test("leaves the office out while office reservations are closed", async () => {
    const result = await listOfferings(
      {},
      makeAgentToolTestServices({ officeEnabled: false })
    );

    expect(result.offerings.map(({ family }) => family)).not.toContain(
      "office"
    );
  });

  test("keeps the office without a seat maximum when its capacity is unreadable", async () => {
    const result = await listOfferings(
      {},
      makeAgentToolTestServices({ tables: [] })
    );
    const office = result.offerings.find(({ family }) => family === "office");

    expect(office).toMatchObject({ price: czk(530) });
    expect(office).not.toHaveProperty("max_seats");
  });
});
