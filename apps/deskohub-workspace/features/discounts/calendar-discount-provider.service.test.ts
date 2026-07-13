import "@/shared/testing/workspace-test-env";
import "@/shared/polyfills/temporal";
import { describe, expect, mock, test } from "bun:test";
import {
  GoogleCalendarAPIError,
  type GoogleCalendarEvent,
  type IGoogleCalendarService,
} from "@deskohub/google-calendar";
import { GoogleCalendarServiceMock } from "@deskohub/google-calendar/backend/service.mock";
import { Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import { CalendarResourceConfig } from "@/shared/backend/config/calendar-resource.config";
import { CalendarDiscountProvider } from "./calendar-discount-provider.service";
import { deriveOpaqueDiscountId } from "./opaque-discount-id";

const salesCalendarId = "sales-calendar";
const providerNamespace = "google-calendar-sales";
const basicProduct = { kind: "cowork", tier: "basic" } as const;

const resourceConfigLayer = Layer.succeed(CalendarResourceConfig, {
  workspaceLimitationsCalendarId: "workspace-limitations-calendar",
  salesCalendarId,
});

const saleDescription = (input?: {
  readonly basisPoints?: number;
  readonly products?: readonly ("basic" | "plus" | "profi")[];
  readonly suffix?: string;
}) =>
  [
    "[deskohub:sale]",
    "",
    "[adjustment]",
    'kind = "percentage"',
    `basisPoints = ${input?.basisPoints ?? 2000}`,
    ...(input?.products ?? ["basic"]).flatMap((tier) => [
      "",
      "[[products]]",
      'kind = "cowork"',
      `tier = "${tier}"`,
    ]),
    ...(input?.suffix ? ["", input.suffix] : []),
  ].join("\n");

const saleEvent = (
  input: Partial<GoogleCalendarEvent> = {}
): GoogleCalendarEvent => ({
  id: "sale-event",
  summary: " Summer Sale ",
  description: saleDescription(),
  start: { date: "2026-07-14" },
  end: { date: "2026-08-02" },
  ...input,
});

const runWithProvider = <A, E>(
  effect: Effect.Effect<A, E, CalendarDiscountProvider>,
  listEvents: IGoogleCalendarService["listEvents"]
) =>
  effect.pipe(
    Effect.provide(CalendarDiscountProvider.Live),
    Effect.provide(GoogleCalendarServiceMock({ listEvents })),
    Effect.provide(resourceConfigLayer),
    Effect.provide(TestClock.layer()),
    Effect.runPromise
  );

const quote = Effect.gen(function* () {
  const provider = yield* CalendarDiscountProvider;
  return yield* provider.quote({
    product: basicProduct,
    reservationDate: "2026-07-14",
  });
});

const malformedConfigurationCases = [
  ["invalid TOML", "[deskohub:sale]\n[adjustment", "invalid_toml"],
  [
    "unknown root field",
    saleDescription({ suffix: 'unknown = "field"' }),
    "invalid_sale_configuration",
  ],
  [
    "invalid percentage",
    saleDescription({ basisPoints: 10_001 }),
    "invalid_sale_configuration",
  ],
  [
    "empty products",
    [
      "[deskohub:sale]",
      "products = []",
      "[adjustment]",
      'kind = "percentage"',
      "basisPoints = 1000",
    ].join("\n"),
    "invalid_sale_configuration",
  ],
  [
    "duplicate products",
    saleDescription({ products: ["basic", "basic"] }),
    "invalid_sale_configuration",
  ],
  [
    "invalid product",
    saleDescription().replace('tier = "basic"', 'tier = "enterprise"'),
    "invalid_sale_configuration",
  ],
] as const;

const invalidEventCases = [
  ["missing title", { summary: " " }],
  ["missing ID", { id: undefined, iCalUID: undefined }],
  [
    "timed event",
    {
      start: { dateTime: "2026-07-14T00:00:00+02:00" },
      end: { dateTime: "2026-07-15T00:00:00+02:00" },
    },
  ],
  ["missing end", { end: undefined }],
  ["invalid range", { end: { date: "2026-07-14" } }],
  ["invalid calendar date", { start: { date: "2026-02-30" } }],
  [
    "recurring event without original date",
    {
      recurringEventId: "recurring-sale",
      originalStartTime: undefined,
    },
  ],
] as const;

describe("CalendarDiscountProvider", () => {
  test("loads the sales resource and returns ordered source-neutral candidates", async () => {
    const listEvents = mock(() =>
      Effect.succeed([
        saleEvent({
          id: "sale-b",
          summary: " All tiers ",
          description: saleDescription({
            basisPoints: 2500,
            products: ["basic", "plus", "profi"],
          }),
        }),
        saleEvent({
          id: "sale-a",
          summary: "Basic only",
          description: saleDescription({ basisPoints: 1000 }),
        }),
      ])
    );

    const result = await runWithProvider(
      Effect.gen(function* () {
        const provider = yield* CalendarDiscountProvider;
        const basic = yield* provider.quote({
          product: basicProduct,
          reservationDate: "2026-07-20",
        });
        const plus = yield* provider.quote({
          product: { kind: "cowork", tier: "plus" },
          reservationDate: "2026-07-20",
        });

        return { basic, plus };
      }),
      listEvents
    );

    const expectedIds = ["sale-a", "sale-b"]
      .map((eventReference) =>
        deriveOpaqueDiscountId({
          providerNamespace,
          providerReference: `${salesCalendarId}:${eventReference}`,
        })
      )
      .toSorted();

    expect(listEvents).toHaveBeenCalledTimes(1);
    expect(listEvents.mock.calls[0]?.[0]).toEqual({
      calendarId: salesCalendarId,
      from: "2026-07-20",
      to: "2026-07-20",
    });
    expect(listEvents.mock.calls[0]?.[0].calendarId).not.toBe(
      "workspace-limitations-calendar"
    );
    expect(result.basic.map(({ discount }) => discount.id)).toEqual(
      expectedIds
    );
    expect(
      result.basic.map(({ discount }) => discount.label).toSorted()
    ).toEqual(["All tiers", "Basic only"]);
    expect(result.basic.map(({ discount }) => discount.adjustment)).toEqual(
      expectedIds.map((id) =>
        id ===
        deriveOpaqueDiscountId({
          providerNamespace,
          providerReference: `${salesCalendarId}:sale-a`,
        })
          ? { kind: "percentage", basisPoints: 1000 }
          : { kind: "percentage", basisPoints: 2500 }
      )
    );
    expect(result.basic[0]?.discount.expiresAt).toBe(
      "2026-08-01T22:00:00.000Z"
    );
    expect(result.basic[0]?.discount.countdownStartsAt).toBe(
      "2026-07-31T22:00:00.000Z"
    );
    expect(result.plus).toHaveLength(1);
    expect(result.plus[0]?.discount.label).toBe("All tiers");
    expect(
      JSON.stringify(result.basic.map(({ discount }) => discount))
    ).not.toContain("google-calendar-sales");
  });

  test("ignores cancelled and unmarked events", async () => {
    const result = await runWithProvider(quote, () =>
      Effect.succeed([
        saleEvent({ status: "cancelled" }),
        saleEvent({ description: "ordinary calendar event" }),
        saleEvent({
          description: `Internal note\n${saleDescription()}`,
        }),
        saleEvent({
          description:
            '[deskohub:sale] { adjustment = { kind = "percentage" } }',
        }),
      ])
    );

    expect(result).toEqual([]);
  });

  for (const [label, description, innerReason] of malformedConfigurationCases) {
    test(`fails closed for ${label}`, async () => {
      const result = await runWithProvider(quote.pipe(Effect.result), () =>
        Effect.succeed([saleEvent({ description })])
      );

      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") {
        expect(result.failure).toMatchObject({
          _tag: "DiscountProviderError",
          reason: "malformed_configuration",
          cause: {
            _tag: "CalendarSaleConfigurationError",
            reason: innerReason,
            eventReference: "sale-event",
          },
        });
        expect(result.failure.cause).toHaveProperty("cause");
      }
    });
  }

  for (const [label, event] of invalidEventCases) {
    test(`rejects a marked ${label}`, async () => {
      const result = await runWithProvider(quote.pipe(Effect.result), () =>
        Effect.succeed([saleEvent(event)])
      );

      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") {
        expect(result.failure).toMatchObject({
          reason: "malformed_configuration",
          cause: { _tag: "CalendarSaleConfigurationError" },
        });
      }
    });
  }

  test("maps Google Calendar failures while preserving the cause", async () => {
    const cause = new GoogleCalendarAPIError({
      operation: "events.list",
      statusCode: 503,
      message: "Unavailable",
      cause: new Error("provider unavailable"),
    });

    const result = await runWithProvider(quote.pipe(Effect.result), () =>
      Effect.fail(cause)
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "DiscountProviderError",
        reason: "provider_failure",
        cause,
      },
    });
  });

  test("uses start-inclusive and exclusive-end Prague date semantics", async () => {
    const listEvents = mock(() =>
      Effect.succeed([
        saleEvent({
          id: "spring",
          start: { date: "2026-03-28" },
          end: { date: "2026-03-30" },
        }),
        saleEvent({
          id: "autumn",
          start: { date: "2026-10-24" },
          end: { date: "2026-10-26" },
        }),
      ])
    );

    const result = await runWithProvider(
      Effect.gen(function* () {
        const provider = yield* CalendarDiscountProvider;
        const spring = yield* provider.revalidate({
          product: basicProduct,
          reservationDate: "2026-03-29",
        });
        const springExclusiveEnd = yield* provider.revalidate({
          product: basicProduct,
          reservationDate: "2026-03-30",
        });
        const autumn = yield* provider.revalidate({
          product: basicProduct,
          reservationDate: "2026-10-25",
        });

        return { autumn, spring, springExclusiveEnd };
      }),
      listEvents
    );

    expect(result.spring).toHaveLength(1);
    expect(result.spring[0]?.discount).toMatchObject({
      expiresAt: "2026-03-29T22:00:00.000Z",
      countdownStartsAt: "2026-03-28T22:00:00.000Z",
    });
    expect(result.springExclusiveEnd).toEqual([]);
    expect(result.autumn).toHaveLength(1);
    expect(result.autumn[0]?.discount).toMatchObject({
      expiresAt: "2026-10-25T23:00:00.000Z",
      countdownStartsAt: "2026-10-24T23:00:00.000Z",
    });
  });

  test("uses immutable recurring occurrence dates for stable distinct IDs", async () => {
    let originalDate = "2026-07-14";
    let displayedDate = "2026-07-15";
    const listEvents = mock(() =>
      Effect.succeed([
        saleEvent({
          id: `instance-${displayedDate}`,
          recurringEventId: "recurring-sale",
          originalStartTime: { date: originalDate },
          start: { date: displayedDate },
          end: {
            date: Temporal.PlainDate.from(displayedDate)
              .add({ days: 1 })
              .toString(),
          },
        }),
      ])
    );

    const result = await runWithProvider(
      Effect.gen(function* () {
        const provider = yield* CalendarDiscountProvider;
        const first = yield* provider.revalidate({
          product: basicProduct,
          reservationDate: displayedDate,
        });
        displayedDate = "2026-07-16";
        const moved = yield* provider.revalidate({
          product: basicProduct,
          reservationDate: displayedDate,
        });
        originalDate = "2026-07-21";
        displayedDate = "2026-07-21";
        const nextOccurrence = yield* provider.revalidate({
          product: basicProduct,
          reservationDate: displayedDate,
        });

        return { first, moved, nextOccurrence };
      }),
      listEvents
    );

    expect(result.moved[0]?.discount.id).toBe(result.first[0]?.discount.id);
    expect(result.nextOccurrence[0]?.discount.id).not.toBe(
      result.first[0]?.discount.id
    );
  });

  test("falls back to the iCal UID and occurrence date when event ID is absent", async () => {
    const result = await runWithProvider(quote, () =>
      Effect.succeed([
        saleEvent({
          id: undefined,
          iCalUID: "ical-sale",
        }),
      ])
    );

    const providerReference = `${salesCalendarId}:ical-sale:2026-07-14`;

    expect(result[0]).toMatchObject({
      discount: {
        id: deriveOpaqueDiscountId({
          providerNamespace,
          providerReference,
        }),
      },
      provenance: {
        providerNamespace,
        providerReference,
        details: {
          calendarId: salesCalendarId,
          eventReference: "ical-sale",
          occurrenceDate: "2026-07-14",
        },
      },
    });
  });

  test("caches quotes for 60 seconds while revalidation is always fresh", async () => {
    let label = "Initial sale";
    const listEvents = mock(() =>
      Effect.succeed([saleEvent({ summary: label })])
    );

    const result = await runWithProvider(
      Effect.gen(function* () {
        const provider = yield* CalendarDiscountProvider;
        const first = yield* provider.quote({
          product: basicProduct,
          reservationDate: "2026-07-20",
        });
        label = "Edited sale";
        const cached = yield* provider.quote({
          product: basicProduct,
          reservationDate: "2026-07-20",
        });
        const fresh = yield* provider.revalidate({
          product: basicProduct,
          reservationDate: "2026-07-20",
        });
        yield* TestClock.adjust("61 seconds");
        const afterTtl = yield* provider.quote({
          product: basicProduct,
          reservationDate: "2026-07-20",
        });

        return { afterTtl, cached, first, fresh };
      }),
      listEvents
    );

    expect(result.first[0]?.discount.label).toBe("Initial sale");
    expect(result.cached[0]?.discount.label).toBe("Initial sale");
    expect(result.fresh[0]?.discount.label).toBe("Edited sale");
    expect(result.afterTtl[0]?.discount.label).toBe("Edited sale");
    expect(listEvents).toHaveBeenCalledTimes(3);
  });

  test("does not cache provider failures", async () => {
    const cause = new GoogleCalendarAPIError({
      operation: "events.list",
      message: "Temporary failure",
    });
    let calls = 0;
    const listEvents = mock(() => {
      calls += 1;
      return calls === 1
        ? Effect.fail(cause)
        : Effect.succeed([saleEvent({ summary: "Recovered sale" })]);
    });

    const result = await runWithProvider(
      Effect.gen(function* () {
        const provider = yield* CalendarDiscountProvider;
        const first = yield* provider
          .quote({
            product: basicProduct,
            reservationDate: "2026-07-20",
          })
          .pipe(Effect.result);
        const second = yield* provider.quote({
          product: basicProduct,
          reservationDate: "2026-07-20",
        });

        return { first, second };
      }),
      listEvents
    );

    expect(result.first._tag).toBe("Failure");
    expect(result.second[0]?.discount.label).toBe("Recovered sale");
    expect(listEvents).toHaveBeenCalledTimes(2);
  });
});
