import "@/shared/testing/workspace-test-env";
import { describe, expect, test } from "bun:test";
import { Effect, type Schema } from "effect";
import type { AdvertisedPriceRequest } from "@/features/checkout/advertised-price";
import { m } from "@/features/i18n";
import { coworkSelectionLink } from "@/features/reservation/cowork-selection-link";
import { meetingRoomSelectionLink } from "@/features/reservation/meeting-room-selection-link";
import { officeSelectionLink } from "@/features/reservation/office-selection-link";
import type { GetQuoteResult } from "./get-quote.schema";

const {
  atInstant,
  makeAgentToolTestServices,
  workspaceDateFromToday,
  workspaceInstantToday,
} = await import("./agent-tools.test-utils");
const { getQuoteTool } = await import("./get-quote.tool");
const { buildAdvertisedPrice } = await import(
  "@/features/checkout/backend/checkout/advertised-price.server"
);
const { getCoworkAdvertisedPriceReservation } = await import(
  "@/features/reservation/cowork-reservation"
);
const { getMeetingRoomDurationAdvertisedPriceRequests } = await import(
  "@/features/reservation/meeting-room-advertised-price"
);
const { getOfficeAdvertisedPriceRequest } = await import(
  "@/features/reservation/office-advertised-price"
);

const quote = (
  args: Schema.Json,
  services = makeAgentToolTestServices(),
  now?: Temporal.Instant
) =>
  getQuoteTool
    .call(args)
    .pipe(
      Effect.provide(services.layer),
      now === undefined ? (effect) => effect : atInstant(now),
      Effect.runPromise
    ) as Promise<GetQuoteResult>;

const quoteFailure = (
  args: Schema.Json,
  services = makeAgentToolTestServices()
) =>
  getQuoteTool
    .call(args)
    .pipe(Effect.flip, Effect.provide(services.layer), Effect.runPromise);

/** The total the reservation page would advertise for the same request. */
const advertisedTotal = (
  request: AdvertisedPriceRequest,
  services: ReturnType<typeof makeAgentToolTestServices>
) =>
  buildAdvertisedPrice(request).pipe(
    Effect.map(({ quote }) => quote.payment.expectedPrice.value / 100),
    Effect.provide(services.layer),
    Effect.runPromise
  );

describe("get_quote", () => {
  test("quotes a cowork day exactly as the advertised price, sale included", async () => {
    const date = workspaceDateFromToday(3);
    const services = makeAgentToolTestServices({ saleBasisPoints: 5000 });

    const result = await quote(
      { family: "cowork", date, tier: "open-space", coffee: true },
      services
    );

    expect(result).toMatchObject({
      family: "cowork",
      total: { amount: 195, currency: "CZK" },
      regular_price: { amount: 340 },
      discount: { amount: 145 },
      note: m.agentToolQuoteNote({}, { locale: "en-US" }),
      reservation_url: `http://deskohub.test/reservation/cowork?entryTier=open-space&date=${date}&coffee=true`,
    });
    expect(result.total.amount).toBe(
      await advertisedTotal(
        {
          locale: "en-US",
          reservation: getCoworkAdvertisedPriceReservation({
            entryTier: "open-space",
            coffee: true,
            date,
          }),
        },
        services
      )
    );
    expect(services.dotyposRequests).toEqual([]);
  });

  test("adds the workstation to a Reserved Desk and links its configuration", async () => {
    const date = workspaceDateFromToday(3);
    const result = await quote({
      family: "cowork",
      date,
      tier: "reserved-desk",
      monitor_option: "2x32-4k",
    });

    expect(result).toMatchObject({
      total: { amount: 530 },
      discount: { amount: 0 },
      reservation_url: `http://deskohub.test/reservation/cowork?entryTier=reserved-desk&date=${date}&coffee=true&monitorOption=2x32-4k`,
    });
  });

  test("links a Reserved Desk without a workstation over the customer's remembered one", async () => {
    const date = workspaceDateFromToday(3);
    const services = makeAgentToolTestServices();

    const result = await quote(
      { family: "cowork", date, tier: "reserved-desk" },
      services
    );
    const restored = coworkSelectionLink.read(
      new URL(result.reservation_url).searchParams,
      {
        lastReservation: {
          kind: "cowork",
          entryTier: "reserved-desk",
          coffee: true,
          monitorOption: "2x27-qhd",
        },
      }
    );

    expect(result.total.amount).toBe(410);
    expect(restored).toMatchObject({ entryTier: "reserved-desk", date });
    expect(restored.monitorOption).toBeUndefined();
    expect(
      await advertisedTotal(
        {
          locale: "en-US",
          reservation: getCoworkAdvertisedPriceReservation(restored),
        },
        services
      )
    ).toBe(result.total.amount);
  });

  test("quotes a meeting-room booking exactly as the advertised price", async () => {
    const date = workspaceDateFromToday(5);
    const services = makeAgentToolTestServices();

    const result = await quote(
      {
        family: "meeting-room",
        date,
        start_time: "14:00",
        duration: "hour:4",
        locale: "cs-CZ",
      },
      services
    );
    const request = getMeetingRoomDurationAdvertisedPriceRequests({
      locale: "cs-CZ",
      startDateTime: `${date}T14:00`,
    }).find(
      ({ reservation }) =>
        reservation.details.duration.unit === "hour" &&
        reservation.details.duration.amount === 4
    );

    expect(result).toMatchObject({
      total: { amount: 980 },
      note: m.agentToolQuoteNote({}, { locale: "cs-CZ" }),
    });
    expect(result.total.amount).toBe(await advertisedTotal(request!, services));
  });

  test("links meeting-room and office selections over the customer's remembered options", async () => {
    const date = workspaceDateFromToday(5);
    const today = workspaceDateFromToday(0);

    const meetingRoom = await quote({
      family: "meeting-room",
      date,
      start_time: "14:00",
      duration: "hour:4",
    });
    const office = await quote({
      family: "office",
      date: today,
      end_date: workspaceDateFromToday(1),
      seats: 2,
    });

    expect(
      meetingRoomSelectionLink.read(
        new URL(meetingRoom.reservation_url).searchParams,
        { lastReservation: { kind: "meeting-room", duration: "day:1" } }
      )
    ).toMatchObject({ duration: "hour:4", startDateTime: `${date}T14:00` });
    expect(
      officeSelectionLink.read(new URL(office.reservation_url).searchParams, {
        lastReservation: { kind: "office", dayCount: 5, seats: 4 },
        seatCapacity: 6,
        today,
      })
    ).toMatchObject({ startsOn: today, dayCount: 2, seats: 2 });
    expect(office.note).toBe(m.agentToolQuoteNote({}, { locale: "en-US" }));
  });

  test("links a later office booking on its quoted start over the customer's remembered options", async () => {
    const startsOn = workspaceDateFromToday(3);

    for (const locale of ["en-US", "cs-CZ"] as const) {
      const office = await quote({
        family: "office",
        date: startsOn,
        end_date: workspaceDateFromToday(4),
        seats: 2,
        locale,
      });

      expect(
        officeSelectionLink.read(new URL(office.reservation_url).searchParams, {
          lastReservation: { kind: "office", dayCount: 5, seats: 4 },
          seatCapacity: 6,
          today: workspaceDateFromToday(0),
        })
      ).toMatchObject({ startsOn, dayCount: 2, seats: 2 });
      expect(office.note).toBe(m.agentToolQuoteNote({}, { locale }));
    }
  });

  test("quotes today's whole meeting-room day in the afternoon and links the same selection", async () => {
    const now = workspaceInstantToday("15:20");
    const today = workspaceDateFromToday(0);
    const services = makeAgentToolTestServices();

    const result = await quote(
      { family: "meeting-room", date: today, duration: "day:1" },
      services,
      now
    );
    const request = getMeetingRoomDurationAdvertisedPriceRequests({
      locale: "en-US",
      startDateTime: `${today}T00:00`,
    }).find(({ reservation }) => reservation.details.duration.unit === "day");

    expect(result.total.amount).toBe(await advertisedTotal(request!, services));
    expect(result.reservation_url).toBe(
      `http://deskohub.test/reservation/meeting-room?startDateTime=${today}T00%3A00&duration=day%3A1`
    );
    expect(
      meetingRoomSelectionLink.read(
        new URL(result.reservation_url).searchParams,
        { now }
      )
    ).toMatchObject({ duration: "day:1", startDateTime: `${today}T00:00` });
  });

  test("quotes one cowork date and rejects a cowork date range", async () => {
    const date = workspaceDateFromToday(3);

    const services = makeAgentToolTestServices();
    const sameDay = await quote(
      { family: "cowork", date, end_date: date, tier: "open-space" },
      services
    );
    const range = await quoteFailure({
      family: "cowork",
      date,
      end_date: workspaceDateFromToday(5),
      tier: "open-space",
    });

    expect(sameDay.total.amount).toBe(
      await advertisedTotal(
        {
          locale: "en-US",
          reservation: getCoworkAdvertisedPriceReservation({
            entryTier: "open-space",
            coffee: false,
            date,
          }),
        },
        services
      )
    );
    expect(range.details).toEqual({ code: "invalid_input", field: "end_date" });
    expect(
      getQuoteTool.input["~standard"].jsonSchema.input({
        target: "draft-2020-12",
      })
    ).toMatchObject({
      properties: {
        end_date: { description: expect.stringMatching(/^Office only:/) },
      },
    });
  });

  test("quotes office days and seats exactly as the advertised price", async () => {
    const startsOn = workspaceDateFromToday(2);
    const endsOn = workspaceDateFromToday(3);
    const services = makeAgentToolTestServices();

    const result = await quote(
      { family: "office", date: startsOn, end_date: endsOn, seats: 2 },
      services
    );

    expect(result).toMatchObject({
      total: { amount: 2320 },
      reservation_url: `http://deskohub.test/reservation/office?startsOn=${startsOn}&dayCount=2&seats=2`,
    });
    expect(result.total.amount).toBe(
      await advertisedTotal(
        getOfficeAdvertisedPriceRequest({
          startsOn: startsOn as never,
          endsOn: endsOn as never,
          seats: 2,
          locale: "en-US",
        }),
        services
      )
    );
    expect(services.dotyposRequests).toEqual([]);
  });

  test("rejects choices the selected product does not offer", async () => {
    const date = workspaceDateFromToday(3);

    const noTier = await quoteFailure({ family: "cowork", date });
    const coffeeOnDesk = await quoteFailure({
      family: "cowork",
      date,
      tier: "reserved-desk",
      coffee: false,
    });
    const monitorOnOpenSpace = await quoteFailure({
      family: "cowork",
      date,
      tier: "open-space",
      monitor_option: "2x27-qhd",
    });
    const tooManySeats = await quoteFailure({
      family: "office",
      date,
      seats: 9,
    });

    expect(noTier.details).toEqual({ code: "invalid_input", field: "tier" });
    expect(coffeeOnDesk.details).toEqual({
      code: "invalid_input",
      field: "coffee",
    });
    expect(monitorOnOpenSpace.details).toEqual({
      code: "invalid_input",
      field: "monitor_option",
    });
    expect(tooManySeats.details).toEqual({
      code: "invalid_input",
      field: "seats",
    });
  });

  test("reports the office as unsupported while office reservations are closed", async () => {
    const failure = await quoteFailure(
      { family: "office", date: workspaceDateFromToday(1) },
      makeAgentToolTestServices({ officeEnabled: false })
    );

    expect(failure.details).toEqual({ code: "unsupported_family" });
  });
});
