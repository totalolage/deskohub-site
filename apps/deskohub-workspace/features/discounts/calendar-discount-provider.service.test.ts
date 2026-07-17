import "@/shared/testing/workspace-test-env";
import "@/shared/polyfills/temporal";
import { describe, expect, mock, test } from "bun:test";
import {
  GoogleCalendarAPIError,
  type GoogleCalendarEvent,
  type IGoogleCalendarService,
} from "@deskohub/google-calendar";
import { GoogleCalendarServiceMock } from "@deskohub/google-calendar/backend/service.mock";
import { Effect, Layer, Schema, Scope } from "effect";
import { TestClock } from "effect/testing";
import { DatabaseError } from "@/db/database.service";
import { CalendarResourceConfig } from "@/shared/backend/config/calendar-resource.config";
import { CalendarDiscountProvider } from "./calendar-discount-provider.service";
import type { DiscountDefinition } from "./discount-definition";
import {
  DiscountDefinitionNotFoundError,
  type IDiscountDefinitionRepository,
} from "./discount-definition.repository";
import { DiscountDefinitionRepositoryMock } from "./discount-definition.repository.mock";
import { deriveOpaqueDiscountId } from "./opaque-discount-id";
import {
  type StoredDiscountId,
  storedDiscountIdSchema,
} from "./persistence-contracts";

const salesCalendarId = "sales-calendar";
const providerNamespace = "google-calendar-sales";
const basicProduct = { kind: "cowork", tier: "basic" } as const;

const discountIdA = Schema.decodeUnknownSync(storedDiscountIdSchema)(
  "019bfe6e-8ef0-7def-8b16-55cfbc82edb7"
);
const discountIdB = Schema.decodeUnknownSync(storedDiscountIdSchema)(
  "019bfe6e-8ef0-7def-8b16-55cfbc82edb8"
);

const resourceConfigLayer = Layer.succeed(CalendarResourceConfig, {
  workspaceLimitationsCalendarId: "workspace-limitations-calendar",
  salesCalendarId,
});

const definition = (
  id: StoredDiscountId,
  overrides: Partial<DiscountDefinition> = {}
): DiscountDefinition => ({
  id,
  labels: {
    "en-US": "Database sale",
    "cs-CZ": "Databázová sleva",
  },
  adjustment: { kind: "percentage", basisPoints: 2000 },
  products: [basicProduct],
  ...overrides,
});

const saleEvent = (
  input: Partial<GoogleCalendarEvent> = {}
): GoogleCalendarEvent => ({
  id: "sale-event",
  summary: "Operator calendar title",
  description: discountIdA,
  start: { date: "2026-07-14" },
  end: { date: "2026-08-02" },
  ...input,
});

const defaultLoadById: IDiscountDefinitionRepository["loadById"] = ({
  discountId,
}) => Effect.succeed(definition(discountId));

const runWithProvider = <A, E>(
  effect: Effect.Effect<A, E, CalendarDiscountProvider>,
  listEvents: IGoogleCalendarService["listEvents"],
  loadById: IDiscountDefinitionRepository["loadById"] = defaultLoadById
) =>
  effect.pipe(
    Effect.provide(CalendarDiscountProvider.Live),
    Effect.provide(GoogleCalendarServiceMock({ listEvents })),
    Effect.provide(DiscountDefinitionRepositoryMock({ loadById })),
    Effect.provide(resourceConfigLayer),
    Effect.provide(TestClock.layer()),
    Effect.runPromise
  );

const quote = Effect.gen(function* () {
  const provider = yield* CalendarDiscountProvider;
  return yield* provider.quote({
    locale: "en-US",
    product: basicProduct,
    reservationDate: "2026-07-14",
  });
});

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
  test("loads database definitions and returns ordered source-neutral candidates", async () => {
    const listEvents = mock(() =>
      Effect.succeed([
        saleEvent({
          id: "sale-b",
          summary: "Title that is not public B",
          description: discountIdB,
        }),
        saleEvent({
          id: "sale-a",
          summary: "Title that is not public A",
          description: discountIdA,
        }),
      ])
    );
    const definitions = new Map<StoredDiscountId, DiscountDefinition>([
      [
        discountIdA,
        definition(discountIdA, {
          labels: {
            "en-US": "Basic database sale",
            "cs-CZ": "Základní databázová sleva",
          },
          adjustment: { kind: "percentage", basisPoints: 1000 },
        }),
      ],
      [
        discountIdB,
        definition(discountIdB, {
          labels: {
            "en-US": "All-tier fixed sale",
            "cs-CZ": "Pevná sleva pro všechny tarify",
          },
          adjustment: {
            kind: "fixed",
            amount: { value: 5000, exponent: 2, currency: "CZK" },
          },
          products: [
            basicProduct,
            { kind: "cowork", tier: "plus" },
            { kind: "cowork", tier: "profi" },
          ],
        }),
      ],
    ]);
    const loadById = mock<IDiscountDefinitionRepository["loadById"]>(
      ({ discountId }) => Effect.succeed(definitions.get(discountId)!)
    );

    const result = await runWithProvider(
      Effect.gen(function* () {
        const provider = yield* CalendarDiscountProvider;
        const basic = yield* provider.quote({
          locale: "en-US",
          product: basicProduct,
          reservationDate: "2026-07-20",
        });
        const plus = yield* provider.quote({
          locale: "en-US",
          product: { kind: "cowork", tier: "plus" },
          reservationDate: "2026-07-20",
        });
        return { basic, plus };
      }),
      listEvents,
      loadById
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
    expect(result.basic.map(({ discount }) => discount.id)).toEqual(
      expectedIds
    );
    expect(
      result.basic.map(({ discount }) => discount.label).toSorted()
    ).toEqual(["All-tier fixed sale", "Basic database sale"]);
    expect(result.basic.map(({ discount }) => discount.adjustment)).toEqual(
      expect.arrayContaining([
        { kind: "percentage", basisPoints: 1000 },
        {
          kind: "fixed",
          amount: { value: 5000, exponent: 2, currency: "CZK" },
        },
      ])
    );
    expect(result.plus).toHaveLength(1);
    expect(result.plus[0]?.discount.label).toBe("All-tier fixed sale");
    expect(result.basic[0]?.discount.expiresAt).toBe(
      "2026-08-01T22:00:00.000Z"
    );
    expect(result.basic[0]?.discount.countdownStartsAt).toBe(
      "2026-07-31T22:00:00.000Z"
    );
    expect(loadById).toHaveBeenCalledTimes(2);
    expect(
      JSON.stringify(result.basic.map(({ discount }) => discount))
    ).not.toContain(discountIdA);
    expect(
      JSON.stringify(result.basic.map(({ discount }) => discount))
    ).not.toContain(discountIdB);
  });

  test("ignores cancelled events and events without a description", async () => {
    const loadById = mock(defaultLoadById);
    const result = await runWithProvider(
      quote,
      () =>
        Effect.succeed([
          saleEvent({ status: "cancelled" }),
          saleEvent({ description: undefined }),
          saleEvent({ description: " " }),
        ]),
      loadById
    );

    expect(result).toEqual([]);
    expect(loadById).not.toHaveBeenCalled();
  });

  test.each([
    ["non-UUID description", "ordinary calendar note"],
    ["UUID with prose", `Sale ${discountIdA}`],
    ["multiple UUIDs", `${discountIdA}\n${discountIdB}`],
    ["rich-text UUID", `<p><code>${discountIdA}</code></p>`],
    ["rich-text UUID with prose", `<p><code>Sale ${discountIdA}</code></p>`],
    [
      "rich-text multiple UUIDs",
      `<p><code>${discountIdA} ${discountIdB}</code></p>`,
    ],
    ["paragraph-wrapped UUID", `<p>${discountIdA}</p>`],
  ])("fails closed for %s", async (_label, description) => {
    const result = await runWithProvider(quote.pipe(Effect.result), () =>
      Effect.succeed([saleEvent({ description })])
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        reason: "malformed_configuration",
        cause: {
          _tag: "CalendarSaleConfigurationError",
          reason: "invalid_discount_reference",
        },
      },
    });
  });

  test("accepts an uppercase UUID and normalizes it before lookup", async () => {
    const loadById = mock(defaultLoadById);

    await runWithProvider(
      quote,
      () =>
        Effect.succeed([saleEvent({ description: discountIdA.toUpperCase() })]),
      loadById
    );

    expect(loadById).toHaveBeenCalledWith({ discountId: discountIdA });
  });

  for (const [label, event] of invalidEventCases) {
    test(`rejects a referenced ${label}`, async () => {
      const result = await runWithProvider(quote.pipe(Effect.result), () =>
        Effect.succeed([saleEvent(event)])
      );

      expect(result).toMatchObject({
        _tag: "Failure",
        failure: {
          reason: "malformed_configuration",
          cause: { _tag: "CalendarSaleConfigurationError" },
        },
      });
    });
  }

  test("ignores a definition unavailable in this environment", async () => {
    const cause = new DiscountDefinitionNotFoundError({
      discountId: discountIdA,
      message: "Not found",
    });
    const result = await runWithProvider(
      quote,
      () => Effect.succeed([saleEvent()]),
      () => Effect.fail(cause)
    );

    expect(result).toEqual([]);
  });

  test("maps database failures while preserving the cause", async () => {
    const cause = new DatabaseError({
      operation: "discountDefinitions.loadById",
      cause: new Error("database unavailable"),
    });
    const result = await runWithProvider(
      quote.pipe(Effect.result),
      () => Effect.succeed([saleEvent()]),
      () => Effect.fail(cause)
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        reason: "provider_failure",
        cause,
      },
    });
  });

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
          locale: "en-US",
          product: basicProduct,
          reservationDate: "2026-03-29",
        });
        const springExclusiveEnd = yield* provider.revalidate({
          locale: "en-US",
          product: basicProduct,
          reservationDate: "2026-03-30",
        });
        const autumn = yield* provider.revalidate({
          locale: "en-US",
          product: basicProduct,
          reservationDate: "2026-10-25",
        });
        return { autumn, spring, springExclusiveEnd };
      }),
      listEvents
    );

    expect(result.spring[0]?.discount).toMatchObject({
      expiresAt: "2026-03-29T22:00:00.000Z",
      countdownStartsAt: "2026-03-28T22:00:00.000Z",
    });
    expect(result.springExclusiveEnd).toEqual([]);
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
          locale: "en-US",
          product: basicProduct,
          reservationDate: displayedDate,
        });
        displayedDate = "2026-07-16";
        const moved = yield* provider.revalidate({
          locale: "en-US",
          product: basicProduct,
          reservationDate: displayedDate,
        });
        originalDate = "2026-07-21";
        displayedDate = "2026-07-21";
        const nextOccurrence = yield* provider.revalidate({
          locale: "en-US",
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
          storedDiscountId: discountIdA,
        },
      },
    });
  });

  test("loads one definition for overlapping occurrences that share it", async () => {
    const loadById = mock(defaultLoadById);
    const result = await runWithProvider(
      quote,
      () =>
        Effect.succeed([
          saleEvent({ id: "sale-a" }),
          saleEvent({ id: "sale-b" }),
        ]),
      loadById
    );

    expect(result).toHaveLength(2);
    expect(result[0]?.discount.id).not.toBe(result[1]?.discount.id);
    expect(loadById).toHaveBeenCalledTimes(1);
  });

  test("resolves two locales from one locale-independent cache entry", async () => {
    const listEvents = mock(() => Effect.succeed([saleEvent()]));
    const loadById = mock(defaultLoadById);

    const result = await runWithProvider(
      Effect.gen(function* () {
        const provider = yield* CalendarDiscountProvider;
        const english = yield* provider.quote({
          locale: "en-US",
          product: basicProduct,
          reservationDate: "2026-07-20",
        });
        const czech = yield* provider.quote({
          locale: "cs-CZ",
          product: basicProduct,
          reservationDate: "2026-07-20",
        });
        return { czech, english };
      }),
      listEvents,
      loadById
    );

    expect(result.english[0]?.discount.label).toBe("Database sale");
    expect(result.czech[0]?.discount.label).toBe("Databázová sleva");
    expect(listEvents).toHaveBeenCalledTimes(1);
    expect(loadById).toHaveBeenCalledTimes(1);
  });

  test("keeps the operator title out of the public label", async () => {
    let title = "Initial operator title";
    const listEvents = mock(() =>
      Effect.succeed([saleEvent({ summary: title })])
    );

    const result = await runWithProvider(
      Effect.gen(function* () {
        const provider = yield* CalendarDiscountProvider;
        const initial = yield* provider.revalidate({
          locale: "en-US",
          product: basicProduct,
          reservationDate: "2026-07-20",
        });
        title = "Edited operator title";
        const afterTitleEdit = yield* provider.revalidate({
          locale: "en-US",
          product: basicProduct,
          reservationDate: "2026-07-20",
        });
        return { afterTitleEdit, initial };
      }),
      listEvents
    );

    expect(result.initial[0]?.discount.label).toBe("Database sale");
    expect(result.afterTitleEdit[0]?.discount.label).toBe("Database sale");
    expect(JSON.stringify(result)).not.toContain("operator title");
  });

  test("caches resolved definitions for 60 seconds while revalidation is fresh", async () => {
    let currentLabels = {
      "en-US": "Initial database sale",
      "cs-CZ": "Počáteční databázová sleva",
    };
    const listEvents = mock(() => Effect.succeed([saleEvent()]));
    const loadById = mock<IDiscountDefinitionRepository["loadById"]>(
      ({ discountId }) =>
        Effect.succeed(definition(discountId, { labels: currentLabels }))
    );

    const result = await runWithProvider(
      Effect.gen(function* () {
        const provider = yield* CalendarDiscountProvider;
        const first = yield* provider.quote({
          locale: "en-US",
          product: basicProduct,
          reservationDate: "2026-07-20",
        });
        currentLabels = {
          "en-US": "Edited database sale",
          "cs-CZ": "Upravená databázová sleva",
        };
        const cached = yield* provider.quote({
          locale: "en-US",
          product: basicProduct,
          reservationDate: "2026-07-20",
        });
        const fresh = yield* provider.revalidate({
          locale: "en-US",
          product: basicProduct,
          reservationDate: "2026-07-20",
        });
        yield* TestClock.adjust("61 seconds");
        const afterTtl = yield* provider.quote({
          locale: "en-US",
          product: basicProduct,
          reservationDate: "2026-07-20",
        });
        return { afterTtl, cached, first, fresh };
      }),
      listEvents,
      loadById
    );

    expect(result.first[0]?.discount.label).toBe("Initial database sale");
    expect(result.cached[0]?.discount.label).toBe("Initial database sale");
    expect(result.fresh[0]?.discount.label).toBe("Edited database sale");
    expect(result.afterTtl[0]?.discount.label).toBe("Edited database sale");
    expect(listEvents).toHaveBeenCalledTimes(3);
    expect(loadById).toHaveBeenCalledTimes(3);
  });

  test("keeps the quote cache across separate process-lifetime layer builds", async () => {
    let currentLabels = {
      "en-US": "Initial database sale",
      "cs-CZ": "Počáteční databázová sleva",
    };
    const listEvents = mock(() => Effect.succeed([saleEvent()]));
    const loadById = mock<IDiscountDefinitionRepository["loadById"]>(
      ({ discountId }) =>
        Effect.succeed(definition(discountId, { labels: currentLabels }))
    );
    const processMemoMap = Layer.makeMemoMapUnsafe();
    const processScope = Scope.makeUnsafe();
    const providerLayer = Layer.fromBuild(() =>
      Layer.buildWithMemoMap(
        CalendarDiscountProvider.Live.pipe(
          Layer.provide(
            Layer.mergeAll(
              GoogleCalendarServiceMock({ listEvents }),
              DiscountDefinitionRepositoryMock({ loadById }),
              resourceConfigLayer
            )
          )
        ),
        processMemoMap,
        processScope
      )
    );
    const quoteForDate = Effect.gen(function* () {
      const provider = yield* CalendarDiscountProvider;
      return yield* provider.quote({
        locale: "en-US",
        product: basicProduct,
        reservationDate: "2026-07-20",
      });
    });
    const revalidateForDate = Effect.gen(function* () {
      const provider = yield* CalendarDiscountProvider;
      return yield* provider.revalidate({
        locale: "en-US",
        product: basicProduct,
        reservationDate: "2026-07-20",
      });
    });

    const first = await quoteForDate.pipe(
      Effect.provide(providerLayer),
      Effect.runPromise
    );
    currentLabels = {
      "en-US": "Edited database sale",
      "cs-CZ": "Upravená databázová sleva",
    };
    const cached = await quoteForDate.pipe(
      Effect.provide(providerLayer),
      Effect.runPromise
    );
    const fresh = await revalidateForDate.pipe(
      Effect.provide(providerLayer),
      Effect.runPromise
    );
    const stillCached = await quoteForDate.pipe(
      Effect.provide(providerLayer),
      Effect.runPromise
    );

    expect(first[0]?.discount.label).toBe("Initial database sale");
    expect(cached[0]?.discount.label).toBe("Initial database sale");
    expect(fresh[0]?.discount.label).toBe("Edited database sale");
    expect(stillCached[0]?.discount.label).toBe("Initial database sale");
    expect(listEvents).toHaveBeenCalledTimes(2);
    expect(loadById).toHaveBeenCalledTimes(2);
  });

  test("does not cache definition-provider failures", async () => {
    const cause = new DatabaseError({
      operation: "discountDefinitions.loadById",
      cause: new Error("temporary failure"),
    });
    let calls = 0;
    const loadById = mock<IDiscountDefinitionRepository["loadById"]>(
      ({ discountId }) => {
        calls += 1;
        return calls === 1
          ? Effect.fail(cause)
          : Effect.succeed(
              definition(discountId, {
                labels: {
                  "en-US": "Recovered sale",
                  "cs-CZ": "Obnovená sleva",
                },
              })
            );
      }
    );

    const result = await runWithProvider(
      Effect.gen(function* () {
        const provider = yield* CalendarDiscountProvider;
        const first = yield* provider
          .quote({
            locale: "en-US",
            product: basicProduct,
            reservationDate: "2026-07-20",
          })
          .pipe(Effect.result);
        const second = yield* provider.quote({
          locale: "en-US",
          product: basicProduct,
          reservationDate: "2026-07-20",
        });
        return { first, second };
      }),
      () => Effect.succeed([saleEvent()]),
      loadById
    );

    expect(result.first._tag).toBe("Failure");
    expect(result.second[0]?.discount.label).toBe("Recovered sale");
    expect(loadById).toHaveBeenCalledTimes(2);
  });
});
