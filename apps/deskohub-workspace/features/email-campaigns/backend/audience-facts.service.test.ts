import { describe, expect, mock, test } from "bun:test";
import {
  type DotyposCustomerId,
  DotyposCustomerIdSchema,
  type DotyposReservation,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { DotyposServiceMock } from "@deskohub/dotypos/backend/service.mock";
import type { ReservationProductFilterType } from "@deskohub/workspace-admin-api";
import { Effect, Exit, Layer } from "effect";
import { TestClock } from "effect/testing";
import {
  type AudienceCondition,
  type AudienceFacts,
  type AudienceFilter,
  audienceFactKey,
} from "../audience-filter";
import {
  type DatePeriod,
  type DatePeriodBounds,
  datePeriodBounds,
} from "../date-period";
import { audienceEvaluationAt } from "./audience-evaluation-context";
import { AudienceFactsService } from "./audience-facts.service";
import {
  type CampaignBookedReservation,
  CampaignCandidateRepository,
  type CampaignReservationSelection,
} from "./campaign-candidate.repository";

const customerId = (value: string) => DotyposCustomerIdSchema.make(value);
const reservationId = (value: string) => DotyposReservationIdSchema.make(value);
const instant = (value: string) => Temporal.Instant.from(value);

/** 12:00 in Prague (CEST). */
const now = instant("2026-10-15T10:00:00Z");

const visit = (id: string, startsAt: string): DotyposReservation =>
  ({
    id: reservationId(id),
    startDate: startsAt,
    endDate: instant(startsAt).add({ hours: 1 }).toString(),
  }) as DotyposReservation;

const group = (...filters: AudienceFilter[]): AudienceFilter => ({
  _tag: "Group",
  operator: "and",
  filters,
});

const resolveFacts = async (input: {
  readonly filter: AudienceFilter;
  readonly now?: Temporal.Instant;
  readonly visits?: readonly DotyposReservation[];
  readonly booked?: readonly CampaignBookedReservation[];
  readonly earliestReservationAt?: Temporal.Instant | null;
}) => {
  const countReservations = mock((_: CampaignReservationSelection) =>
    Effect.succeed(new Map<DotyposCustomerId, number>())
  );
  const countReceivedCampaignEmails = mock(
    (_: { readonly purpose?: string; readonly dispatched: DatePeriodBounds }) =>
      Effect.succeed(new Map<DotyposCustomerId, number>())
  );
  const accountCreations = mock((_: DatePeriodBounds) =>
    Effect.succeed({
      withValue: new Set<DotyposCustomerId>(),
      inPeriod: new Set<DotyposCustomerId>(),
    })
  );
  const listBookedReservations = mock(
    (
      ids: readonly string[],
      _selection?: { readonly product?: ReservationProductFilterType }
    ) =>
      Effect.succeed(
        (input.booked ?? []).filter(({ dotyposReservationId }) =>
          ids.includes(dotyposReservationId)
        )
      )
  );
  const listReservations = mock(
    (_: {
      readonly startsAtOrAfter?: string;
      readonly startsBefore?: string;
    }) => Effect.succeed(input.visits ?? [])
  );
  const evaluationTime = input.now ?? now;
  const exit = await Effect.runPromiseExit(
    Effect.gen(function* () {
      yield* TestClock.setTime(evaluationTime.epochMilliseconds);
      const service = yield* AudienceFactsService;
      return yield* service.resolve({
        filter: input.filter,
        contexts: [audienceEvaluationAt(evaluationTime)],
      });
    }).pipe(
      Effect.provide(
        AudienceFactsService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(CampaignCandidateRepository)({
                countReservations,
                countReceivedCampaignEmails,
                accountCreations,
                listBookedReservations,
                earliestReservationAt: Effect.succeed(
                  input.earliestReservationAt === undefined
                    ? instant("2025-01-10T12:00:00Z")
                    : input.earliestReservationAt
                ),
              }),
              DotyposServiceMock({ listReservations } as never)
            )
          )
        )
      ),
      Effect.provide(TestClock.layer())
    )
  );
  return {
    exit,
    countReservations,
    countReceivedCampaignEmails,
    accountCreations,
    listBookedReservations,
    listReservations,
  };
};

/** The key of a last-visit request evaluated at `at`. */
const lastVisitKey = (period: DatePeriod, at: Temporal.Instant = now) =>
  audienceFactKey({
    attribute: "lastVisit",
    bounds: datePeriodBounds(period, audienceEvaluationAt(at)),
    asOf: at,
  });

const facts = (exit: Exit.Exit<AudienceFacts, unknown>) => {
  if (Exit.isFailure(exit)) throw new Error(String(exit.cause));
  return exit.value;
};

const emails = (
  purpose: "marketing" | "operational" | "any",
  period: Extract<
    AudienceCondition,
    { attribute: "campaignEmailCount" }
  >["params"]["period"]
): AudienceCondition => ({
  attribute: "campaignEmailCount",
  _tag: "Condition",
  params: { purpose, period },
  operator: "eq",
  value: 0,
});

const reservations = (
  params: Extract<
    AudienceCondition,
    { attribute: "reservationCount" }
  >["params"]
): AudienceCondition => ({
  attribute: "reservationCount",
  _tag: "Condition",
  params,
  operator: "gt",
  value: 0,
});

describe("AudienceFactsService periods", () => {
  test("counts emails dispatched in the last N days up to the send time", async () => {
    const { countReceivedCampaignEmails } = await resolveFacts({
      filter: group(
        emails("marketing", { _tag: "Last", count: 10, unit: "day" }),
        emails("any", { _tag: "AnyTime" })
      ),
    });
    expect(
      countReceivedCampaignEmails.mock.calls.map(([query]) => query)
    ).toEqual([
      {
        purpose: "marketing",
        dispatched: {
          startsAtOrAfter: instant("2026-10-05T10:00:00Z"),
          startsAtOrBefore: now,
        },
      },
      { dispatched: {} },
    ]);
  });

  test("steps months back through the Prague calendar across a DST change", async () => {
    // 11:00 CET on 10 November is 11:00 CEST on 10 October.
    const { countReceivedCampaignEmails } = await resolveFacts({
      now: instant("2026-11-10T10:00:00Z"),
      filter: emails("operational", { _tag: "Last", count: 1, unit: "month" }),
    });
    expect(countReceivedCampaignEmails.mock.calls[0]?.[0].dispatched).toEqual({
      startsAtOrAfter: instant("2026-10-10T09:00:00Z"),
      startsAtOrBefore: instant("2026-11-10T10:00:00Z"),
    });
  });

  test("dates booking periods by Prague midnights, with since ending now and onward open", async () => {
    const { countReservations, listReservations } = await resolveFacts({
      filter: group(
        reservations({
          dateBasis: "booking",
          period: { _tag: "Range", from: "2026-03-01", to: "2026-03-31" },
          status: "complete",
        }),
        reservations({
          dateBasis: "booking",
          period: { _tag: "Since", date: "2026-10-01" },
        }),
        reservations({
          dateBasis: "booking",
          period: { _tag: "Onward", date: "2026-10-01" },
        })
      ),
    });
    expect(listReservations).not.toHaveBeenCalled();
    expect(
      countReservations.mock.calls.map(([selection]) => selection)
    ).toEqual([
      {
        status: "complete",
        booked: {
          startsAtOrAfter: instant("2026-02-28T23:00:00Z"),
          startsBefore: instant("2026-03-31T22:00:00Z"),
        },
      },
      {
        booked: {
          startsAtOrAfter: instant("2026-09-30T22:00:00Z"),
          startsAtOrBefore: now,
        },
      },
      { booked: { startsAtOrAfter: instant("2026-09-30T22:00:00Z") } },
    ]);
  });
});

describe("AudienceFactsService Dotypos bounds", () => {
  test("counts visits in a period through one bounded Dotypos range per period", async () => {
    const { countReservations, listReservations } = await resolveFacts({
      visits: [visit("r1", "2026-03-10T08:00:00Z")],
      filter: group(
        reservations({
          dateBasis: "visit",
          period: { _tag: "Range", from: "2026-03-01", to: "2026-03-31" },
        }),
        reservations({
          dateBasis: "visit",
          period: { _tag: "Until", date: "2026-03-31" },
        }),
        reservations({
          dateBasis: "visit",
          period: { _tag: "Onward", date: "2026-10-01" },
        }),
        reservations({ dateBasis: "visit", period: { _tag: "AnyTime" } })
      ),
    });
    expect(listReservations.mock.calls.map(([options]) => options)).toEqual([
      {
        startsAtOrAfter: "2026-02-28T23:00:00Z",
        startsBefore: "2026-03-31T22:00:00Z",
      },
      // No start of its own: a week before the earliest Workspace reservation.
      {
        startsAtOrAfter: "2025-01-03T12:00:00Z",
        startsBefore: "2026-03-31T22:00:00Z",
      },
      // Onward keeps future visits.
      { startsAtOrAfter: "2026-09-30T22:00:00Z" },
    ]);
    expect(
      countReservations.mock.calls.map(([selection]) => selection)
    ).toEqual([
      { dotyposReservationIds: [reservationId("r1")] },
      { dotyposReservationIds: [reservationId("r1")] },
      { dotyposReservationIds: [reservationId("r1")] },
      {},
    ]);
  });

  test("skips Dotypos when Workspace has no reservations at all", async () => {
    const { listReservations, exit } = await resolveFacts({
      earliestReservationAt: null,
      filter: group(
        reservations({
          dateBasis: "visit",
          period: { _tag: "Until", date: "2026-03-31" },
        }),
        { attribute: "lastVisit", _tag: "Condition", operator: "none" }
      ),
    });
    expect(listReservations).not.toHaveBeenCalled();
    expect([...facts(exit).dates.values()]).toEqual([
      { withValue: new Set(), inPeriod: new Set() },
    ]);
  });
});

describe("AudienceFactsService last visit", () => {
  const recent = { _tag: "Last", count: 30, unit: "day" } as const;
  const lastVisit = (
    operator: "in" | "notIn",
    value: Extract<
      AudienceCondition,
      { attribute: "lastVisit"; operator: "in" | "notIn" }
    >["value"]
  ): AudienceCondition => ({
    attribute: "lastVisit",
    _tag: "Condition",
    operator,
    value,
  });

  const run = () =>
    resolveFacts({
      filter: group(
        lastVisit("notIn", recent),
        lastVisit("in", {
          _tag: "Range",
          from: "2026-08-01",
          to: "2026-09-30",
        }),
        { attribute: "lastVisit", _tag: "Condition", operator: "none" }
      ),
      visits: [
        visit("a-old", "2026-08-20T08:00:00Z"),
        visit("a-recent", "2026-10-10T08:00:00Z"),
        visit("b-old", "2026-09-01T08:00:00Z"),
        visit("c-unbooked", "2026-10-12T08:00:00Z"),
      ],
      booked: [
        {
          dotyposReservationId: reservationId("a-old"),
          dotyposCustomerId: customerId("a"),
        },
        {
          dotyposReservationId: reservationId("a-recent"),
          dotyposCustomerId: customerId("a"),
        },
        {
          dotyposReservationId: reservationId("b-old"),
          dotyposCustomerId: customerId("b"),
        },
      ],
    });

  test("reads every last-visit condition from one Dotypos range ending now", async () => {
    const { listReservations } = await run();
    expect(listReservations.mock.calls.map(([options]) => options)).toEqual([
      // Dotypos has no inclusive end, so "at or before now" ends 1 ms later.
      {
        startsAtOrAfter: "2025-01-03T12:00:00Z",
        startsBefore: "2026-10-15T10:00:00.001Z",
      },
    ]);
  });

  test("takes each customer's latest booked visit as the value", async () => {
    const { dates } = facts((await run()).exit);
    expect(dates.get(lastVisitKey(recent))).toEqual({
      withValue: new Set([customerId("a"), customerId("b")]),
      inPeriod: new Set([customerId("a")]),
    });
    // A visit in August no longer counts as the last one after an October visit.
    expect(
      dates.get(
        lastVisitKey({ _tag: "Range", from: "2026-08-01", to: "2026-09-30" })
      )?.inPeriod
    ).toEqual(new Set([customerId("b")]));
  });

  test("reads account creation dates locally", async () => {
    const { accountCreations, listReservations } = await resolveFacts({
      filter: {
        attribute: "accountCreated",
        _tag: "Condition",
        operator: "in",
        value: { _tag: "Since", date: "2026-09-01" },
      },
    });
    expect(listReservations).not.toHaveBeenCalled();
    expect(accountCreations.mock.calls[0]?.[0]).toEqual({
      startsAtOrAfter: instant("2026-08-31T22:00:00Z"),
      startsAtOrBefore: now,
    });
  });
});

describe("AudienceFactsService evaluation time", () => {
  const lastDay = { _tag: "Last", count: 1, unit: "day" } as const;

  test("counts a visit that starts exactly at the evaluation time", async () => {
    const { listReservations, dates } = await resolveFacts({
      filter: {
        attribute: "lastVisit",
        _tag: "Condition",
        operator: "in",
        value: lastDay,
      },
      visits: [visit("starting-now", now.toString())],
      booked: [
        {
          dotyposReservationId: reservationId("starting-now"),
          dotyposCustomerId: customerId("a"),
        },
      ],
    }).then(({ exit, listReservations }) => ({
      listReservations,
      dates: facts(exit).dates,
    }));
    expect(listReservations.mock.calls[0]?.[0].startsBefore).toBe(
      "2026-10-15T10:00:00.001Z"
    );
    expect(dates.get(lastVisitKey(lastDay))).toEqual({
      withValue: new Set([customerId("a")]),
      inPeriod: new Set([customerId("a")]),
    });
  });

  test("ends visit-dated counts at the evaluation time, inclusive", async () => {
    const { listReservations } = await resolveFacts({
      filter: reservations({ dateBasis: "visit", period: lastDay }),
    });
    expect(listReservations.mock.calls.map(([options]) => options)).toEqual([
      {
        startsAtOrAfter: "2026-10-14T10:00:00Z",
        startsBefore: "2026-10-15T10:00:00.001Z",
      },
    ]);
  });

  test("keeps calendar-day ends at the next Prague midnight, exclusive", async () => {
    const { countReceivedCampaignEmails } = await resolveFacts({
      filter: emails("any", { _tag: "Until", date: "2026-10-15" }),
    });
    expect(countReceivedCampaignEmails.mock.calls[0]?.[0].dispatched).toEqual({
      startsBefore: instant("2026-10-15T22:00:00Z"),
    });
  });
});

describe("AudienceFactsService product filters", () => {
  const coworkDesk = {
    family: "cowork",
    properties: [
      { property: "tier", operator: "anyOf", value: ["reserved-desk"] },
    ],
  } as const;

  test("passes a product filter to reservation counts and last visits", async () => {
    const { countReservations, listBookedReservations, listReservations } =
      await resolveFacts({
        visits: [visit("r1", "2026-10-01T08:00:00Z")],
        filter: group(
          reservations({
            dateBasis: "booking",
            period: { _tag: "AnyTime" },
            product: coworkDesk,
          }),
          {
            attribute: "lastVisit",
            _tag: "Condition",
            params: { product: coworkDesk },
            operator: "none",
          },
          { attribute: "lastVisit", _tag: "Condition", operator: "none" }
        ),
      });
    expect(countReservations.mock.calls[0]?.[0]).toEqual({
      product: coworkDesk,
      booked: {},
    });
    // One Dotypos range serves both last-visit conditions; only the local
    // booked-reservation join differs by product.
    expect(listReservations).toHaveBeenCalledTimes(1);
    expect(
      listBookedReservations.mock.calls.map(
        ([, selection]) => selection?.product
      )
    ).toEqual([coworkDesk, undefined]);
  });
});
