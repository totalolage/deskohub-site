import "@/shared/testing/workspace-test-env";
import "@/shared/polyfills/temporal";
import { describe, expect, mock, test } from "bun:test";
import type {
  GoogleCalendarEvent,
  IGoogleCalendarService,
} from "@deskohub/google-calendar";
import { GoogleCalendarServiceMock } from "@deskohub/google-calendar/backend/service.mock";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Effect, Layer, Schema, Scope } from "effect";
import { TestClock } from "effect/testing";
import {
  CalendarResourceConfig,
  salesCalendarIdSchema,
  workspaceLimitationsCalendarIdSchema,
} from "@/shared/backend/config/calendar-resource.config";
import {
  CalendarDiscountProvider,
  type ICalendarDiscountProvider,
} from "./calendar-discount-provider.service";
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

const salesCalendarId = Schema.decodeUnknownSync(salesCalendarIdSchema)(
  "sales-calendar"
);
const workspaceLimitationsCalendarId = Schema.decodeUnknownSync(
  workspaceLimitationsCalendarIdSchema
)("workspace-limitations-calendar");
const providerNamespace = "google-calendar-sales";
const basicProduct = { kind: "cowork", tier: "basic" } as const;
const coworkTarget = { kind: "cowork" } as const;

const discountIdA = Schema.decodeUnknownSync(storedDiscountIdSchema)(
  "019bfe6e-8ef0-7def-8b16-55cfbc82edb7"
);
const discountIdB = Schema.decodeUnknownSync(storedDiscountIdSchema)(
  "019bfe6e-8ef0-7def-8b16-55cfbc82edb8"
);

const resourceConfigLayer = Layer.succeed(CalendarResourceConfig, {
  workspaceLimitationsCalendarId,
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
  products: [coworkTarget],
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

/** Midday in Prague on the given date: a booking made during that day. */
const bookedAtOn = (date: string) =>
  Temporal.PlainDate.from(date)
    .toZonedDateTime({ timeZone: "Europe/Prague", plainTime: "12:00" })
    .toInstant();

const defaultLoadById: IDiscountDefinitionRepository["loadById"] = ({
  discountId,
}) => Effect.succeed(definition(discountId));

const runWithProvider = <A, E>(
  effect: Effect.Effect<A, E, CalendarDiscountProvider>,
  listEvents: IGoogleCalendarService["listEvents"],
  loadById: IDiscountDefinitionRepository["loadById"] = defaultLoadById
) =>
  effect.pipe(
    Effect.provide(
      Layer.mergeAll(
        CalendarDiscountProvider.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              GoogleCalendarServiceMock({ listEvents }),
              DiscountDefinitionRepositoryMock({ loadById }),
              resourceConfigLayer
            )
          )
        ),
        TestClock.layer()
      )
    ),
    Effect.runPromise
  );

/** The candidates a Calendar affirmation resolves, ignoring completeness. */
const revalidateCandidates = (
  provider: ICalendarDiscountProvider,
  input: Parameters<ICalendarDiscountProvider["revalidate"]>[0]
) =>
  provider.revalidate(input).pipe(Effect.map(({ candidates }) => candidates));

const revalidate = Effect.gen(function* () {
  const provider = yield* CalendarDiscountProvider;
  return yield* provider.revalidate({
    locale: "en-US",
    product: basicProduct,
    lastServiceDate: "2026-07-14",
    bookedAt: bookedAtOn("2026-07-14"),
  });
});

const discover = Effect.gen(function* () {
  const provider = yield* CalendarDiscountProvider;
  return yield* provider.discover({
    locale: "en-US",
    product: basicProduct,
    lastServiceDate: "2026-07-14",
    bookedAt: bookedAtOn("2026-07-14"),
  });
});

const discoverCandidates = discover.pipe(
  Effect.map(({ candidates }) => candidates)
);

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
  [
    "recurring event without original date",
    {
      recurringEventId: "recurring-sale",
      originalStartTime: undefined,
    },
  ],
] as const;

describe("CalendarDiscountProvider", () => {
  test("discovers localized active sales with their complete product targets", async () => {
    const products = [coworkTarget, { kind: "meeting-room" } as const];
    const listEvents = mock(() => Effect.succeed([saleEvent()]));

    const result = await runWithProvider(
      Effect.gen(function* () {
        yield* TestClock.setTime(bookedAtOn("2026-07-20").epochMilliseconds);
        const provider = yield* CalendarDiscountProvider;
        return yield* provider.discoverActiveSales({ locale: "cs-CZ" });
      }),
      listEvents,
      ({ discountId }) =>
        Effect.succeed(
          definition(discountId, {
            adjustment: {
              kind: "fixed",
              amount: { value: 5000, exponent: 2, currency: "CZK" },
            },
            products,
          })
        )
    );

    expect(listEvents).toHaveBeenCalledWith({
      calendarId: salesCalendarId,
      from: "2026-07-20",
      to: "2026-07-20",
    });
    expect(result).toEqual({
      activeSales: [
        expect.objectContaining({
          discount: {
            id: expect.any(String),
            label: "Databázová sleva",
            adjustment: {
              kind: "fixed",
              amount: { value: 5000, exponent: 2, currency: "CZK" },
            },
            countdownStartsAt: expect.any(String),
            expiresAt: expect.any(String),
          },
          products,
        }),
      ],
      complete: true,
    });
    expect(JSON.stringify(result)).not.toContain("Operator calendar title");
    expect(JSON.stringify(result)).not.toContain(discountIdA);
  });

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
            "en-US": "Percentage database sale",
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
          products: [coworkTarget],
        }),
      ],
    ]);
    const loadById = mock<IDiscountDefinitionRepository["loadById"]>(
      ({ discountId }) => Effect.succeed(definitions.get(discountId)!)
    );

    const result = await runWithProvider(
      Effect.gen(function* () {
        const provider = yield* CalendarDiscountProvider;
        const basic = yield* provider.discover({
          locale: "en-US",
          product: basicProduct,
          lastServiceDate: "2026-07-20",
          bookedAt: bookedAtOn("2026-07-20"),
        });
        const plus = yield* provider.discover({
          locale: "en-US",
          product: { kind: "cowork", tier: "plus" },
          lastServiceDate: "2026-07-20",
          bookedAt: bookedAtOn("2026-07-20"),
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
    expect(result.basic.candidates.map(({ discount }) => discount.id)).toEqual(
      expectedIds
    );
    expect(
      result.basic.candidates.map(({ discount }) => discount.label).toSorted()
    ).toEqual(["All-tier fixed sale", "Percentage database sale"]);
    expect(
      result.basic.candidates.map(({ discount }) => discount.adjustment)
    ).toEqual(
      expect.arrayContaining([
        { kind: "percentage", basisPoints: 1000 },
        {
          kind: "fixed",
          amount: { value: 5000, exponent: 2, currency: "CZK" },
        },
      ])
    );
    expect(
      result.plus.candidates.map(({ discount }) => discount.label).toSorted()
    ).toEqual(["All-tier fixed sale", "Percentage database sale"]);
    expect(result.basic.candidates[0]?.discount.expiresAt).toBe(
      "2026-08-01T22:00:00.000Z"
    );
    expect(result.basic.candidates[0]?.discount.countdownStartsAt).toBe(
      "2026-07-31T22:00:00.000Z"
    );
    expect(result.basic.complete).toBeTrue();
    expect(result.plus.complete).toBeTrue();
    expect(loadById).toHaveBeenCalledTimes(2);
    expect(
      JSON.stringify(result.basic.candidates.map(({ discount }) => discount))
    ).not.toContain(discountIdA);
    expect(
      JSON.stringify(result.basic.candidates.map(({ discount }) => discount))
    ).not.toContain(discountIdB);
  });

  test("applies a tier-targeted sale only to that tier and a broad sale to every tier", async () => {
    const listEvents = mock(() =>
      Effect.succeed([
        saleEvent({ id: "sale-a", description: discountIdA }),
        saleEvent({ id: "sale-b", description: discountIdB }),
      ])
    );
    const definitions = new Map<StoredDiscountId, DiscountDefinition>([
      [
        discountIdA,
        definition(discountIdA, {
          labels: { "en-US": "Reserved desk sale", "cs-CZ": "Sleva na stůl" },
          products: [{ kind: "cowork", tier: "reserved-desk" }],
        }),
      ],
      [
        discountIdB,
        definition(discountIdB, {
          labels: { "en-US": "Cowork sale", "cs-CZ": "Sleva na cowork" },
          products: [coworkTarget],
        }),
      ],
    ]);
    const input = (tier: "open-space" | "reserved-desk") => ({
      locale: "en-US" as const,
      product: { kind: "cowork" as const, tier },
      lastServiceDate: "2026-07-20",
      bookedAt: bookedAtOn("2026-07-20"),
    });

    const labels = await runWithProvider(
      Effect.gen(function* () {
        const provider = yield* CalendarDiscountProvider;
        const toLabels = (
          candidates: readonly { discount: { label: string } }[]
        ) => candidates.map(({ discount }) => discount.label).toSorted();
        return {
          openSpace: toLabels(
            (yield* provider.discover(input("open-space"))).candidates
          ),
          reservedDesk: toLabels(
            (yield* provider.discover(input("reserved-desk"))).candidates
          ),
          revalidatedOpenSpace: toLabels(
            yield* revalidateCandidates(provider, input("open-space"))
          ),
          revalidatedReservedDesk: toLabels(
            yield* revalidateCandidates(provider, input("reserved-desk"))
          ),
        };
      }),
      listEvents,
      ({ discountId }) => Effect.succeed(definitions.get(discountId)!)
    );

    expect(labels).toEqual({
      openSpace: ["Cowork sale"],
      reservedDesk: ["Cowork sale", "Reserved desk sale"],
      revalidatedOpenSpace: ["Cowork sale"],
      revalidatedReservedDesk: ["Cowork sale", "Reserved desk sale"],
    });
  });

  test("keeps other tiers eligible while one tier target is removed", async () => {
    const listEvents = mock(() => Effect.succeed([saleEvent()]));
    let products: DiscountDefinition["products"] = [
      { kind: "cowork", tier: "open-space" },
      { kind: "cowork", tier: "reserved-desk" },
    ];
    const input = (tier: "open-space" | "reserved-desk") => ({
      locale: "en-US" as const,
      product: { kind: "cowork" as const, tier },
      lastServiceDate: "2026-07-20",
      bookedAt: bookedAtOn("2026-07-20"),
    });

    const counts = await runWithProvider(
      Effect.gen(function* () {
        const provider = yield* CalendarDiscountProvider;
        products = [{ kind: "cowork", tier: "open-space" }];
        // The discovery source is cached here, while reserved desk is removed.
        const openSpace = yield* provider.discover(input("open-space"));
        const reservedDesk = yield* provider.discover(input("reserved-desk"));
        products = [
          { kind: "cowork", tier: "open-space" },
          { kind: "cowork", tier: "reserved-desk" },
        ];
        const cachedOpenSpace = yield* provider.discover(input("open-space"));
        const revalidatedReservedDesk = yield* revalidateCandidates(
          provider,
          input("reserved-desk")
        );
        return {
          openSpace: openSpace.candidates.length,
          reservedDesk: reservedDesk.candidates.length,
          cachedOpenSpace: cachedOpenSpace.candidates.length,
          revalidatedReservedDesk: revalidatedReservedDesk.length,
        };
      }),
      listEvents,
      ({ discountId }) => Effect.succeed(definition(discountId, { products }))
    );

    expect(counts).toEqual({
      openSpace: 1,
      reservedDesk: 0,
      cachedOpenSpace: 1,
      revalidatedReservedDesk: 1,
    });
  });

  test("ignores cancelled events and events without a description", async () => {
    const loadById = mock(defaultLoadById);
    const result = await runWithProvider(
      discoverCandidates,
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
    ["rich-text UUID", `<p><code>${discountIdA}</code></p>`],
  ])("omits a malformed %s event", async (_label, description) => {
    const result = await runWithProvider(discoverCandidates, () =>
      Effect.succeed([saleEvent({ description })])
    );

    expect(result).toEqual([]);
  });

  test("accepts an uppercase UUID and normalizes it before lookup", async () => {
    const loadById = mock(defaultLoadById);

    await runWithProvider(
      discover,
      () =>
        Effect.succeed([saleEvent({ description: discountIdA.toUpperCase() })]),
      loadById
    );

    expect(loadById).toHaveBeenCalledWith({ discountId: discountIdA });
  });

  for (const [label, event] of invalidEventCases) {
    test(`omits a referenced ${label}`, async () => {
      const result = await runWithProvider(discoverCandidates, () =>
        Effect.succeed([saleEvent(event)])
      );

      expect(result).toEqual([]);
    });
  }

  test("keeps valid sales when another calendar event is malformed", async () => {
    const result = await runWithProvider(discoverCandidates, () =>
      Effect.succeed([
        saleEvent({ id: "valid-sale" }),
        saleEvent({ id: "malformed-sale", description: "not-a-discount-id" }),
      ])
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.provenance.providerReference).toBe(
      `${salesCalendarId}:valid-sale`
    );
  });

  test("keeps valid definitions when another definition fails to load", async () => {
    const cause = new EffectDrizzleQueryError({
      query: "select discount definition",
      params: [],
      cause: new Error("database unavailable"),
    });
    const loadById = mock<IDiscountDefinitionRepository["loadById"]>(
      ({ discountId }) =>
        discountId === discountIdB
          ? Effect.fail(cause)
          : Effect.succeed(definition(discountId))
    );
    const result = await runWithProvider(
      discover,
      () =>
        Effect.succeed([
          saleEvent({ id: "valid-sale", description: discountIdA }),
          saleEvent({ id: "failed-sale", description: discountIdB }),
        ]),
      loadById
    );

    expect(result.complete).toBeFalse();
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.provenance.details).toMatchObject({
      storedDiscountId: discountIdA,
    });
    expect(loadById).toHaveBeenCalledTimes(2);
  });

  test("reports an affirmation incomplete when a definition fails to load", async () => {
    const cause = new EffectDrizzleQueryError({
      query: "select discount definition",
      params: [],
      cause: new Error("database unavailable"),
    });
    const result = await runWithProvider(
      revalidate,
      () =>
        Effect.succeed([
          saleEvent({ id: "valid-sale", description: discountIdA }),
          saleEvent({ id: "failed-sale", description: discountIdB }),
        ]),
      ({ discountId }) =>
        discountId === discountIdB
          ? Effect.fail(cause)
          : Effect.succeed(definition(discountId))
    );

    expect(result.complete).toBeFalse();
    expect(result.candidates).toHaveLength(1);
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
        const spring = yield* revalidateCandidates(provider, {
          locale: "en-US",
          product: basicProduct,
          lastServiceDate: "2026-03-29",
          bookedAt: bookedAtOn("2026-03-29"),
        });
        const springExclusiveEnd = yield* revalidateCandidates(provider, {
          locale: "en-US",
          product: basicProduct,
          lastServiceDate: "2026-03-30",
          bookedAt: bookedAtOn("2026-03-30"),
        });
        const autumn = yield* revalidateCandidates(provider, {
          locale: "en-US",
          product: basicProduct,
          lastServiceDate: "2026-10-25",
          bookedAt: bookedAtOn("2026-10-25"),
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
        const first = yield* revalidateCandidates(provider, {
          locale: "en-US",
          product: basicProduct,
          lastServiceDate: displayedDate,
          bookedAt: bookedAtOn(displayedDate),
        });
        displayedDate = "2026-07-16";
        const moved = yield* revalidateCandidates(provider, {
          locale: "en-US",
          product: basicProduct,
          lastServiceDate: displayedDate,
          bookedAt: bookedAtOn(displayedDate),
        });
        originalDate = "2026-07-21";
        displayedDate = "2026-07-21";
        const nextOccurrence = yield* revalidateCandidates(provider, {
          locale: "en-US",
          product: basicProduct,
          lastServiceDate: displayedDate,
          bookedAt: bookedAtOn(displayedDate),
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
    const result = await runWithProvider(discoverCandidates, () =>
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
      discoverCandidates,
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
        const english = yield* provider.discover({
          locale: "en-US",
          product: basicProduct,
          lastServiceDate: "2026-07-20",
          bookedAt: bookedAtOn("2026-07-20"),
        });
        const czech = yield* provider.discover({
          locale: "cs-CZ",
          product: basicProduct,
          lastServiceDate: "2026-07-20",
          bookedAt: bookedAtOn("2026-07-20"),
        });
        return { czech, english };
      }),
      listEvents,
      loadById
    );

    expect(result.english.candidates[0]?.discount.label).toBe("Database sale");
    expect(result.czech.candidates[0]?.discount.label).toBe("Databázová sleva");
    expect(result.english.complete).toBeTrue();
    expect(result.czech.complete).toBeTrue();
    expect(listEvents).toHaveBeenCalledTimes(1);
    expect(loadById).toHaveBeenCalledTimes(1);
  });

  test("isolates transient definition mutations by event identity and date cache key", async () => {
    const definitions = new Map<StoredDiscountId, DiscountDefinition>([
      [discountIdA, definition(discountIdA)],
      [discountIdB, definition(discountIdB)],
    ]);
    const listEvents = mock(
      ({ from }: Parameters<IGoogleCalendarService["listEvents"]>[0]) =>
        Effect.succeed([
          saleEvent({
            description: from === "2026-07-14" ? discountIdA : discountIdB,
            id: from === "2026-07-14" ? "quote-change" : "payment-change",
            start: { date: from },
            end: {
              date: Temporal.PlainDate.from(from).add({ days: 1 }).toString(),
            },
          }),
        ])
    );
    const loadById = mock(
      ({ discountId }: { readonly discountId: StoredDiscountId }) => {
        const loaded = definitions.get(discountId);
        return loaded
          ? Effect.succeed(loaded)
          : Effect.fail(
              new DiscountDefinitionNotFoundError({
                discountId,
                message: "Definition missing from isolated fixture",
              })
            );
      }
    );

    const result = await runWithProvider(
      Effect.gen(function* () {
        const provider = yield* CalendarDiscountProvider;
        const quoteBeforeMutation = yield* provider.discover({
          locale: "en-US",
          product: basicProduct,
          lastServiceDate: "2026-07-14",
          bookedAt: bookedAtOn("2026-07-14"),
        });
        definitions.set(discountIdA, definition(discountIdA, { products: [] }));
        const quoteAfterMutation = yield* revalidateCandidates(provider, {
          locale: "en-US",
          product: basicProduct,
          lastServiceDate: "2026-07-14",
          bookedAt: bookedAtOn("2026-07-14"),
        });
        const independentPaymentCase = yield* provider.discover({
          locale: "en-US",
          product: basicProduct,
          lastServiceDate: "2026-07-15",
          bookedAt: bookedAtOn("2026-07-15"),
        });
        const cachedQuoteCase = yield* provider.discover({
          locale: "en-US",
          product: basicProduct,
          lastServiceDate: "2026-07-14",
          bookedAt: bookedAtOn("2026-07-14"),
        });
        return {
          cachedQuoteCase,
          independentPaymentCase,
          quoteAfterMutation,
          quoteBeforeMutation,
        };
      }),
      listEvents,
      loadById
    );

    expect(result.quoteBeforeMutation.candidates).toHaveLength(1);
    expect(result.quoteBeforeMutation.complete).toBeTrue();
    expect(result.quoteAfterMutation).toHaveLength(0);
    expect(result.independentPaymentCase.candidates).toHaveLength(1);
    expect(result.cachedQuoteCase.candidates).toHaveLength(1);
    expect(
      result.independentPaymentCase.candidates[0]?.provenance.details
    ).toMatchObject({
      eventReference: "payment-change",
      storedDiscountId: discountIdB,
    });
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
        const first = yield* provider.discover({
          locale: "en-US",
          product: basicProduct,
          lastServiceDate: "2026-07-20",
          bookedAt: bookedAtOn("2026-07-20"),
        });
        currentLabels = {
          "en-US": "Edited database sale",
          "cs-CZ": "Upravená databázová sleva",
        };
        const cached = yield* provider.discover({
          locale: "en-US",
          product: basicProduct,
          lastServiceDate: "2026-07-20",
          bookedAt: bookedAtOn("2026-07-20"),
        });
        const fresh = yield* revalidateCandidates(provider, {
          locale: "en-US",
          product: basicProduct,
          lastServiceDate: "2026-07-20",
          bookedAt: bookedAtOn("2026-07-20"),
        });
        yield* TestClock.adjust("61 seconds");
        const afterTtl = yield* provider.discover({
          locale: "en-US",
          product: basicProduct,
          lastServiceDate: "2026-07-20",
          bookedAt: bookedAtOn("2026-07-20"),
        });
        return { afterTtl, cached, first, fresh };
      }),
      listEvents,
      loadById
    );

    expect(result.first.candidates[0]?.discount.label).toBe(
      "Initial database sale"
    );
    expect(result.cached.candidates[0]?.discount.label).toBe(
      "Initial database sale"
    );
    expect(result.fresh[0]?.discount.label).toBe("Edited database sale");
    expect(result.afterTtl.candidates[0]?.discount.label).toBe(
      "Edited database sale"
    );
    expect(result.first.complete).toBeTrue();
    expect(listEvents).toHaveBeenCalledTimes(3);
    expect(loadById).toHaveBeenCalledTimes(3);
  });

  test("evaluates a sale at the booking instant rather than the current time", async () => {
    const listEvents = mock(() => Effect.succeed([saleEvent()]));
    const lastBookableInstant = Temporal.Instant.from(
      "2026-08-01T21:59:59.500Z"
    );

    const result = await runWithProvider(
      Effect.gen(function* () {
        yield* TestClock.setTime(lastBookableInstant.epochMilliseconds);
        const provider = yield* CalendarDiscountProvider;
        const bookedBeforeExpiry = yield* provider.discover({
          locale: "en-US",
          product: basicProduct,
          lastServiceDate: "2026-07-20",
          bookedAt: lastBookableInstant,
        });
        yield* TestClock.adjust("1 second");
        const activeSalesAfterExpiry = yield* provider.discoverActiveSales({
          locale: "en-US",
        });
        const bookedAfterExpiry = yield* provider.discover({
          locale: "en-US",
          product: basicProduct,
          lastServiceDate: "2026-07-20",
          bookedAt: lastBookableInstant.add({ seconds: 1 }),
        });
        const storedBookingAfterExpiry = yield* revalidateCandidates(provider, {
          locale: "en-US",
          product: basicProduct,
          lastServiceDate: "2026-07-20",
          bookedAt: lastBookableInstant,
        });

        return {
          activeSalesAfterExpiry,
          bookedAfterExpiry,
          bookedBeforeExpiry,
          storedBookingAfterExpiry,
        };
      }),
      listEvents
    );

    expect(result.bookedBeforeExpiry.candidates).toHaveLength(1);
    expect(result.bookedBeforeExpiry.complete).toBeTrue();
    expect(result.activeSalesAfterExpiry.activeSales).toEqual([]);
    expect(result.bookedAfterExpiry.candidates).toEqual([]);
    expect(result.storedBookingAfterExpiry).toHaveLength(1);
    expect(listEvents.mock.calls.map(([input]) => input.from)).toEqual([
      "2026-08-01",
      "2026-08-02",
      "2026-08-01",
    ]);
  });

  test("opens the booking window at the Prague start of the first sale day", async () => {
    const firstBookableInstant = Temporal.Instant.from("2026-07-13T22:00:00Z");

    const result = await runWithProvider(
      Effect.gen(function* () {
        const provider = yield* CalendarDiscountProvider;
        const bookedBeforeStart = yield* revalidateCandidates(provider, {
          locale: "en-US",
          product: basicProduct,
          lastServiceDate: "2026-07-20",
          bookedAt: firstBookableInstant.subtract({ milliseconds: 1 }),
        });
        const bookedAtStart = yield* revalidateCandidates(provider, {
          locale: "en-US",
          product: basicProduct,
          lastServiceDate: "2026-07-20",
          bookedAt: firstBookableInstant,
        });
        return { bookedAtStart, bookedBeforeStart };
      }),
      () => Effect.succeed([saleEvent()])
    );

    expect(result.bookedBeforeStart).toEqual([]);
    expect(result.bookedAtStart).toHaveLength(1);
  });

  test.each([
    ["before the sale started", "2026-07-01", 1],
    ["on the sale's last day", "2026-08-01", 1],
    ["after the sale's last day", "2026-08-02", 0],
  ] as const)(
    "applies a booking made during the sale for a last service date %s",
    async (_label, lastServiceDate, expectedCount) => {
      const result = await runWithProvider(
        Effect.gen(function* () {
          const provider = yield* CalendarDiscountProvider;
          return yield* revalidateCandidates(provider, {
            locale: "en-US",
            product: basicProduct,
            lastServiceDate,
            bookedAt: bookedAtOn("2026-07-20"),
          });
        }),
        () => Effect.succeed([saleEvent()])
      );

      expect(result).toHaveLength(expectedCount);
    }
  );

  test("keeps the discovery cache across separate process-lifetime layer builds", async () => {
    let currentLabels = {
      "en-US": "Initial database sale",
      "cs-CZ": "Počáteční databázová sleva",
    };
    const listEvents = mock(() =>
      Effect.succeed([saleEvent({ end: { date: "2099-01-01" } })])
    );
    const loadById = mock<IDiscountDefinitionRepository["loadById"]>(
      ({ discountId }) =>
        Effect.succeed(definition(discountId, { labels: currentLabels }))
    );
    const processMemoMap = Layer.makeMemoMapUnsafe();
    const processScope = Scope.makeUnsafe();
    const providerLayer = Layer.mergeAll(
      Layer.fromBuild(() =>
        Layer.buildWithMemoMap(
          CalendarDiscountProvider.Default.pipe(
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
      ),
      TestClock.layer()
    );
    const testLayer = Layer.merge(providerLayer, TestClock.layer());
    const quoteForDate = Effect.gen(function* () {
      const provider = yield* CalendarDiscountProvider;
      return yield* provider.discover({
        locale: "en-US",
        product: basicProduct,
        lastServiceDate: "2026-07-20",
        bookedAt: bookedAtOn("2026-07-20"),
      });
    });
    const revalidateForDate = Effect.gen(function* () {
      const provider = yield* CalendarDiscountProvider;
      return yield* revalidateCandidates(provider, {
        locale: "en-US",
        product: basicProduct,
        lastServiceDate: "2026-07-20",
        bookedAt: bookedAtOn("2026-07-20"),
      });
    });
    const first = await quoteForDate.pipe(
      Effect.provide(testLayer),
      Effect.runPromise
    );
    currentLabels = {
      "en-US": "Edited database sale",
      "cs-CZ": "Upravená databázová sleva",
    };
    const cached = await quoteForDate.pipe(
      Effect.provide(testLayer),
      Effect.runPromise
    );
    const fresh = await revalidateForDate.pipe(
      Effect.provide(testLayer),
      Effect.runPromise
    );
    const stillCached = await quoteForDate.pipe(
      Effect.provide(testLayer),
      Effect.runPromise
    );

    expect(first.candidates[0]?.discount.label).toBe("Initial database sale");
    expect(cached.candidates[0]?.discount.label).toBe("Initial database sale");
    expect(fresh[0]?.discount.label).toBe("Edited database sale");
    expect(stillCached.candidates[0]?.discount.label).toBe(
      "Initial database sale"
    );
    expect(first.complete).toBeTrue();
    expect(listEvents).toHaveBeenCalledTimes(2);
    expect(loadById).toHaveBeenCalledTimes(2);
  });

  test("does not cache omitted definition-provider failures", async () => {
    const cause = new EffectDrizzleQueryError({
      query: "select discount definition",
      params: [],
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
        const first = yield* provider.discover({
          locale: "en-US",
          product: basicProduct,
          lastServiceDate: "2026-07-20",
          bookedAt: bookedAtOn("2026-07-20"),
        });
        const second = yield* provider.discover({
          locale: "en-US",
          product: basicProduct,
          lastServiceDate: "2026-07-20",
          bookedAt: bookedAtOn("2026-07-20"),
        });
        return { first, second };
      }),
      () => Effect.succeed([saleEvent()]),
      loadById
    );

    expect(result.first.candidates).toEqual([]);
    expect(result.first.complete).toBeFalse();
    expect(result.second.candidates[0]?.discount.label).toBe("Recovered sale");
    expect(result.second.complete).toBeTrue();
    expect(loadById).toHaveBeenCalledTimes(2);
  });
});
