import { describe, expect, mock, test } from "bun:test";
import {
  type DotyposCustomer,
  type DotyposCustomerId,
  DotyposCustomerIdSchema,
  type DotyposReservation,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { DotyposServiceMock } from "@deskohub/dotypos/backend/service.mock";
import type { ReservationProductFilterType } from "@deskohub/workspace-admin-api";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import { TestClock } from "effect/testing";
import type { ReservationVisit } from "@/features/reservation/backend/reservation-visits.service";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
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
import {
  AudienceFactSource,
  type AudienceFactSource as AudienceFactSourceType,
  AudienceScope,
  type AudienceScope as AudienceScopeType,
  audienceEvaluationAt,
} from "./audience-evaluation-context";
import {
  AudienceFactsService,
  audienceDotyposReads,
} from "./audience-facts.service";
import {
  type CampaignBookedReservation,
  CampaignCandidateRepository,
  type CampaignReservationSelection,
} from "./campaign-candidate.repository";

const customerId = (value: string) => DotyposCustomerIdSchema.make(value);
const reservationId = (value: string) => DotyposReservationIdSchema.make(value);
const instant = (value: string) => Temporal.Instant.from(value);
const customerProfile = (id: string): DotyposCustomer =>
  ({
    id: customerId(id),
    _cloudId: "cloud",
    points: "0",
    flags: "0",
    display: true,
    deleted: false,
  }) as DotyposCustomer;

/** 12:00 in Prague (CEST). */
const now = instant("2026-10-15T10:00:00Z");

const visit = (
  id: string,
  startsAt: string,
  status: "NEW" | "CANCELLED" = "NEW"
): DotyposReservation =>
  ({
    id: reservationId(id),
    startDate: startsAt,
    endDate: instant(startsAt).add({ hours: 1 }).toString(),
    status,
  }) as DotyposReservation;

const reservationVisit = (
  id: string,
  customer: string,
  startsAt: string,
  status: ReservationVisit["status"] = "active"
): ReservationVisit => ({
  workspaceReservationId: workspaceReservationIdSchema.make(`workspace-${id}`),
  dotyposReservationId: reservationId(id),
  dotyposCustomerId: customerId(customer),
  startsAt: instant(startsAt),
  endsAt: instant(startsAt).add({ hours: 1 }),
  status,
});

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
  readonly scope?: AudienceScopeType;
  readonly facts?: AudienceFactSourceType;
  readonly respectVisitBounds?: boolean;
  readonly profileCustomers?: readonly DotyposCustomerId[];
  /** Visits stored as early-setup meeting rooms. */
  readonly earlySetup?: readonly string[];
}) => {
  const countReservations = mock((selection: CampaignReservationSelection) => {
    const counts = new Map<DotyposCustomerId, number>();
    for (const { dotyposReservationId, dotyposCustomerId } of input.booked ??
      []) {
      if (
        selection.dotyposReservationIds &&
        !selection.dotyposReservationIds.includes(dotyposReservationId)
      ) {
        continue;
      }
      if (
        selection.customers &&
        !selection.customers.includes(dotyposCustomerId)
      ) {
        continue;
      }
      counts.set(dotyposCustomerId, (counts.get(dotyposCustomerId) ?? 0) + 1);
    }
    return Effect.succeed(counts);
  });
  const countReceivedCampaignEmails = mock(
    (_: { readonly purpose?: string; readonly dispatched: DatePeriodBounds }) =>
      Effect.succeed(new Map<DotyposCustomerId, number>())
  );
  const accountCreations = mock(
    (_: {
      readonly created: DatePeriodBounds;
      readonly asOf: Temporal.Instant;
    }) =>
      Effect.succeed({
        withValue: new Set<DotyposCustomerId>(),
        inPeriod: new Set<DotyposCustomerId>(),
      })
  );
  const listBookedReservations = mock(
    (
      ids: readonly string[],
      selection?: {
        readonly product?: ReservationProductFilterType;
        readonly customers?: readonly DotyposCustomerId[];
      }
    ) =>
      Effect.succeed(
        (input.booked ?? []).filter(
          ({ dotyposReservationId, dotyposCustomerId }) =>
            ids.includes(dotyposReservationId) &&
            (!selection?.customers ||
              selection.customers.includes(dotyposCustomerId))
        )
      )
  );
  const listReservations = mock(
    (options: {
      readonly startsAtOrAfter?: string;
      readonly startsBefore?: string;
    }) => {
      const visits = input.visits ?? [];
      return Effect.succeed(
        input.respectVisitBounds
          ? visits.filter(({ startDate }) => {
              const startsAt = instant(startDate);
              return (
                (!options.startsAtOrAfter ||
                  Temporal.Instant.compare(
                    startsAt,
                    instant(options.startsAtOrAfter)
                  ) >= 0) &&
                (!options.startsBefore ||
                  Temporal.Instant.compare(
                    startsAt,
                    instant(options.startsBefore)
                  ) < 0)
              );
            })
          : visits
      );
    }
  );
  const getCustomers = mock(() => Effect.succeed([]));
  const evaluationTime = input.now ?? now;
  const factsLayer = AudienceFactsService.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(CampaignCandidateRepository)({
          countReservations,
          countReceivedCampaignEmails,
          accountCreations,
          listBookedReservations,
          earlySetupDetails: (ids) =>
            Effect.succeed(
              new Map(
                ids.flatMap((id) =>
                  input.earlySetup?.includes(id)
                    ? [
                        [
                          id,
                          { kind: "meeting-room", earlySetup: true } as const,
                        ] as const,
                      ]
                    : []
                )
              )
            ),
          earliestReservationAt: Effect.succeed(
            input.earliestReservationAt === undefined
              ? instant("2025-01-10T12:00:00Z")
              : input.earliestReservationAt
          ),
        }),
        DotyposServiceMock({ listReservations, getCustomers } as never)
      )
    )
  );
  const exit = await Effect.runPromiseExit(
    Effect.gen(function* () {
      yield* TestClock.setTime(evaluationTime.epochMilliseconds);
      const service = yield* AudienceFactsService;
      return yield* service.resolve({
        filter: input.filter,
        contexts: [audienceEvaluationAt(evaluationTime)],
        ...(input.scope && { scope: input.scope }),
        ...(input.facts && { facts: input.facts }),
      });
    }).pipe(Effect.provide(factsLayer), Effect.provide(TestClock.layer()))
  );
  const profileExit =
    input.profileCustomers === undefined
      ? undefined
      : await Effect.runPromiseExit(
          Effect.gen(function* () {
            const service = yield* AudienceFactsService;
            return yield* service.profiles({
              customers: input.profileCustomers,
              ...(input.facts && { facts: input.facts }),
            });
          }).pipe(Effect.provide(factsLayer))
        );
  return {
    exit,
    profileExit,
    countReservations,
    countReceivedCampaignEmails,
    accountCreations,
    listBookedReservations,
    listReservations,
    getCustomers,
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
    // Each range starts a setup lead early: Dotypos holds an early-setup
    // meeting room from before its booked start.
    expect(listReservations.mock.calls.map(([options]) => options)).toEqual([
      {
        startsAtOrAfter: "2026-02-28T22:45:00Z",
        startsBefore: "2026-03-31T22:00:00Z",
      },
      // No start of its own: a week before the earliest Workspace reservation.
      {
        startsAtOrAfter: "2025-01-03T11:45:00Z",
        startsBefore: "2026-03-31T22:00:00Z",
      },
      // Onward keeps future visits.
      { startsAtOrAfter: "2026-09-30T21:45:00Z" },
    ]);
    expect(
      countReservations.mock.calls.map(([selection]) => selection)
    ).toEqual([
      { dotyposReservationIds: [reservationId("r1")] },
      { dotyposReservationIds: [reservationId("r1")] },
      // The March visit isn't booked in October.
      { dotyposReservationIds: [] },
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

describe("AudienceFactsService early setup", () => {
  // Prague is UTC+1 in March. Early setup holds a meeting room booked from
  // midnight from 23:45 the previous day.
  const heldFromEve = "2026-02-28T22:45:00Z";
  const march = {
    _tag: "Range",
    from: "2026-03-01",
    to: "2026-03-31",
  } as const;
  const booked = ["setup", "unflagged"].map((id) => ({
    dotyposReservationId: reservationId(id),
    dotyposCustomerId: customerId(id),
  }));

  test("counts a midnight early-setup visit on its booked date", async () => {
    const { countReservations } = await resolveFacts({
      visits: [visit("setup", heldFromEve), visit("unflagged", heldFromEve)],
      earlySetup: ["setup"],
      booked,
      respectVisitBounds: true,
      filter: reservations({ dateBasis: "visit", period: march }),
    });

    expect(
      countReservations.mock.calls.map(([selection]) => selection)
    ).toEqual([{ dotyposReservationIds: [reservationId("setup")] }]);
  });

  test("dates a midnight early-setup visit by its booked start", async () => {
    const { exit } = await resolveFacts({
      visits: [visit("setup", heldFromEve), visit("unflagged", heldFromEve)],
      earlySetup: ["setup"],
      booked,
      filter: {
        attribute: "lastVisit",
        _tag: "Condition",
        operator: "in",
        value: march,
      },
    });

    expect(facts(exit).dates.get(lastVisitKey(march))).toEqual({
      withValue: new Set([customerId("setup"), customerId("unflagged")]),
      inPeriod: new Set([customerId("setup")]),
    });
  });

  test("leaves a visit that hasn't reached its booked start out of past visits", async () => {
    const heldFrom = now.subtract({ minutes: 5 }).toString();
    const { exit } = await resolveFacts({
      visits: [visit("setup", heldFrom), visit("unflagged", heldFrom)],
      earlySetup: ["setup"],
      booked,
      filter: { attribute: "lastVisit", _tag: "Condition", operator: "none" },
    });

    expect(
      [...facts(exit).dates.values()].map(({ withValue }) => withValue)
    ).toEqual([new Set([customerId("unflagged")])]);
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
        startsAtOrAfter: "2025-01-03T11:45:00Z",
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
      created: {
        startsAtOrAfter: instant("2026-08-31T22:00:00Z"),
        startsAtOrBefore: now,
      },
      asOf: now,
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

  test("fails visit resolution for a reversed Dotypos interval", async () => {
    const { exit } = await resolveFacts({
      filter: {
        attribute: "lastVisit",
        _tag: "Condition",
        operator: "in",
        value: lastDay,
      },
      visits: [
        {
          ...visit("reversed", now.toString()),
          endDate: instant(now.toString()).subtract({ hours: 1 }).toString(),
        },
      ],
      booked: [
        {
          dotyposReservationId: reservationId("reversed"),
          dotyposCustomerId: customerId("a"),
        },
      ],
    });

    expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toMatchObject({
      _tag: "CampaignRecipientResolutionError",
      source: "dotypos",
    });
  });

  test("ends visit-dated counts at the evaluation time, inclusive", async () => {
    const { listReservations } = await resolveFacts({
      filter: reservations({ dateBasis: "visit", period: lastDay }),
    });
    expect(listReservations.mock.calls.map(([options]) => options)).toEqual([
      {
        startsAtOrAfter: "2026-10-14T09:45:00Z",
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

describe("AudienceFactsService fetched facts", () => {
  test("resolves the same scoped visit and booking facts as live reads", async () => {
    const ids = [customerId("a"), customerId("b"), customerId("c")];
    const scope = AudienceScope.Customers({ ids });
    const recent = { _tag: "Last", count: 30, unit: "day" } as const;
    const history = {
      _tag: "Range",
      from: "2026-08-01",
      to: "2026-09-30",
    } as const;
    const booked: CampaignBookedReservation[] = [
      {
        dotyposReservationId: reservationId("a-cancelled"),
        dotyposCustomerId: ids[0]!,
      },
      {
        dotyposReservationId: reservationId("a-recent"),
        dotyposCustomerId: ids[0]!,
      },
      {
        dotyposReservationId: reservationId("b-old"),
        dotyposCustomerId: ids[1]!,
      },
      {
        dotyposReservationId: reservationId("c-future"),
        dotyposCustomerId: ids[2]!,
      },
    ];
    const dotyposVisits = [
      visit("a-cancelled", "2026-09-20T08:00:00Z", "CANCELLED"),
      visit("a-recent", "2026-10-10T08:00:00Z"),
      visit("b-old", "2026-08-20T08:00:00Z"),
      visit("c-future", "2026-10-20T08:00:00Z"),
    ];
    const fetchedVisits = new Map<
      DotyposCustomerId,
      readonly ReservationVisit[]
    >([
      [
        ids[0]!,
        [
          reservationVisit(
            "a-cancelled",
            "a",
            "2026-09-20T08:00:00Z",
            "cancelled"
          ),
          reservationVisit("a-recent", "a", "2026-10-10T08:00:00Z"),
        ],
      ],
      [ids[1]!, [reservationVisit("b-old", "b", "2026-08-20T08:00:00Z")]],
      [ids[2]!, [reservationVisit("c-future", "c", "2026-10-20T08:00:00Z")]],
    ]);
    const filter = group(
      reservations({ dateBasis: "visit", period: recent }),
      {
        attribute: "lastVisit",
        _tag: "Condition",
        operator: "in",
        value: history,
      },
      {
        attribute: "firstVisit",
        _tag: "Condition",
        operator: "in",
        value: history,
      },
      reservations({
        dateBasis: "booking",
        period: { _tag: "AnyTime" },
      })
    );
    const live = await resolveFacts({
      filter,
      scope,
      visits: dotyposVisits,
      booked,
      respectVisitBounds: true,
    });
    const fetched = await resolveFacts({
      filter,
      scope,
      booked,
      facts: AudienceFactSource.Fetched({
        visits: Option.some(fetchedVisits),
        profiles: Option.none(),
      }),
    });
    const liveFacts = facts(live.exit);
    const fetchedFacts = facts(fetched.exit);

    expect(fetchedFacts).toEqual(liveFacts);
    expect(
      liveFacts.counts.get(
        audienceFactKey({
          attribute: "reservationCount",
          params: {
            dateBasis: "visit",
            period: datePeriodBounds(recent, audienceEvaluationAt(now)),
          },
        })
      )
    ).toEqual(new Map([[ids[0]!, 2]]));
    expect(
      liveFacts.counts.get(
        audienceFactKey({
          attribute: "reservationCount",
          params: {
            dateBasis: "booking",
            period: datePeriodBounds(
              { _tag: "AnyTime" },
              audienceEvaluationAt(now)
            ),
          },
        })
      )
    ).toEqual(
      new Map([
        [ids[0]!, 2],
        [ids[1]!, 1],
        [ids[2]!, 1],
      ])
    );
    expect(liveFacts.dates.get(lastVisitKey(history))).toEqual({
      withValue: new Set([ids[0]!, ids[1]!]),
      inPeriod: new Set([ids[1]!]),
    });
    expect(
      liveFacts.dates.get(
        audienceFactKey({
          attribute: "firstVisit",
          bounds: datePeriodBounds(history, audienceEvaluationAt(now)),
          asOf: now,
        })
      )
    ).toEqual({
      withValue: new Set([ids[0]!, ids[1]!]),
      inPeriod: new Set([ids[0]!, ids[1]!]),
    });
    expect(
      live.countReservations.mock.calls.map(([selection]) => selection)
    ).toContainEqual({
      customers: ids,
      dotyposReservationIds: [
        reservationId("a-cancelled"),
        reservationId("a-recent"),
      ],
    });
    expect(fetched.listReservations).not.toHaveBeenCalled();
    expect(fetched.getCustomers).not.toHaveBeenCalled();
  });

  test("dies when a last-visit resolver reads visits that were not fetched", async () => {
    const { exit } = await resolveFacts({
      filter: {
        attribute: "lastVisit",
        _tag: "Condition",
        operator: "none",
      },
      facts: AudienceFactSource.Fetched({
        visits: Option.none(),
        profiles: Option.none(),
      }),
    });

    expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
  });

  test("dies when a profile condition is evaluated without fetched profiles", async () => {
    const { exit } = await resolveFacts({
      filter: {
        attribute: "dotyposTags",
        _tag: "Condition",
        operator: "anyOf",
        value: ["vip"],
      },
      facts: AudienceFactSource.Fetched({
        visits: Option.some(
          new Map<DotyposCustomerId, readonly ReservationVisit[]>()
        ),
        profiles: Option.none(),
      }),
    });

    expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
  });

  test("returns only requested fetched profiles and an empty map when absent", async () => {
    const requested = [customerId("a"), customerId("b")];
    const fetchedProfiles = new Map<DotyposCustomerId, DotyposCustomer>([
      [customerId("a"), customerProfile("a")],
      [customerId("outside-scope"), customerProfile("outside-scope")],
    ]);
    const available = await resolveFacts({
      filter: group(),
      facts: AudienceFactSource.Fetched({
        visits: Option.none(),
        profiles: Option.some(fetchedProfiles),
      }),
      profileCustomers: requested,
    });
    const missing = await resolveFacts({
      filter: group(),
      facts: AudienceFactSource.Fetched({
        visits: Option.none(),
        profiles: Option.none(),
      }),
      profileCustomers: requested,
    });

    if (
      available.profileExit === undefined ||
      Exit.isFailure(available.profileExit) ||
      missing.profileExit === undefined ||
      Exit.isFailure(missing.profileExit)
    ) {
      throw new Error("profile lookup failed");
    }
    expect([...available.profileExit.value.keys()]).toEqual([requested[0]]);
    expect(missing.profileExit.value).toEqual(new Map());
    expect(available.getCustomers).not.toHaveBeenCalled();
    expect(missing.getCustomers).not.toHaveBeenCalled();
    expect(available.listReservations).not.toHaveBeenCalled();
    expect(missing.listReservations).not.toHaveBeenCalled();
  });
});

describe("audienceDotyposReads", () => {
  const context = audienceEvaluationAt(now);

  test("marks local audience facts and unbounded visit counts as local", () => {
    const filter = group(
      {
        attribute: "locale",
        _tag: "Condition",
        operator: "anyOf",
        value: ["cs-CZ"],
      },
      {
        attribute: "hasAccount",
        _tag: "Condition",
        operator: "is",
        value: true,
      },
      emails("any", { _tag: "AnyTime" }),
      {
        attribute: "accountCreated",
        _tag: "Condition",
        operator: "in",
        value: { _tag: "Last", count: 30, unit: "day" },
      },
      reservations({ dateBasis: "booking", period: { _tag: "AnyTime" } }),
      reservations({ dateBasis: "visit", period: { _tag: "AnyTime" } })
    );

    expect(audienceDotyposReads(filter, [context])).toEqual({
      visits: false,
      profiles: false,
    });
  });

  test("marks profile conditions and date-based visit conditions", () => {
    const dotyposTags: AudienceCondition = {
      attribute: "dotyposTags",
      _tag: "Condition",
      operator: "anyOf",
      value: ["vip"],
    };
    const discountGroup: AudienceCondition = {
      attribute: "discountGroup",
      _tag: "Condition",
      operator: "anyOf",
      value: ["gold"],
    };
    const lastVisit: AudienceCondition = {
      attribute: "lastVisit",
      _tag: "Condition",
      operator: "none",
    };
    const firstVisit: AudienceCondition = {
      attribute: "firstVisit",
      _tag: "Condition",
      operator: "none",
    };
    const boundedVisitCount = reservations({
      dateBasis: "visit",
      period: { _tag: "Last", count: 30, unit: "day" },
    });

    expect(audienceDotyposReads(dotyposTags, [context])).toEqual({
      visits: false,
      profiles: true,
    });
    expect(audienceDotyposReads(discountGroup, [context])).toEqual({
      visits: false,
      profiles: true,
    });
    expect(audienceDotyposReads(lastVisit, [context])).toEqual({
      visits: true,
      profiles: false,
    });
    expect(audienceDotyposReads(firstVisit, [context])).toEqual({
      visits: true,
      profiles: false,
    });
    expect(audienceDotyposReads(boundedVisitCount, [context])).toEqual({
      visits: true,
      profiles: false,
    });
  });
});
