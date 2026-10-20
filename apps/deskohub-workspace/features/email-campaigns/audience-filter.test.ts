import { describe, expect, test } from "bun:test";
import {
  type DotyposCustomer,
  type DotyposCustomerId,
  DotyposCustomerIdSchema,
} from "@deskohub/dotypos";
import {
  type AudienceCountOperatorType,
  audienceAttributeCatalogue,
} from "@deskohub/workspace-admin-api";
import { Option, Result, Schema } from "effect";
import {
  type AudienceCandidate,
  type AudienceCondition,
  type AudienceCountRequest,
  type AudienceDateFacts,
  type AudienceDateRequest,
  type AudienceFacts,
  type AudienceFilter,
  audienceFactKey,
  audienceFilterSchema,
  audienceLocales,
  audienceSingleLocale,
  collectAudienceFactRequests,
  compareCount,
  countFactRequest,
  dateFactRequest,
  matchesSet,
} from "./audience-filter";
import { evaluateAudienceFilter } from "./backend/audience-evaluation";
import {
  type AudienceEvaluationContext,
  audienceEvaluationAt,
} from "./backend/audience-evaluation-context";
import { campaignIdSchema } from "./campaign-identifiers";

const customerId = DotyposCustomerIdSchema.make("customer-1");

/** 12:00 in Prague (CEST). */
const now = Temporal.Instant.from("2026-10-15T10:00:00Z");
const context = audienceEvaluationAt(now);

const candidate: AudienceCandidate = {
  dotyposCustomerId: customerId,
  locale: "en-US",
  hasAccount: true,
};

const profile = (fields: Partial<DotyposCustomer>) =>
  Option.some({ deleted: false, ...fields } as DotyposCustomer);

const group = (
  operator: "and" | "or",
  filters: readonly AudienceFilter[]
): AudienceFilter => ({ _tag: "Group", operator, filters });

const lastTenDays = { _tag: "Last", count: 10, unit: "day" } as const;

const reservationsVisitedInMarch = {
  attribute: "reservationCount",
  _tag: "Condition",
  params: {
    dateBasis: "visit",
    period: { _tag: "Range", from: "2026-03-01", to: "2026-03-31" },
  },
  operator: "gt",
  value: 0,
} as const satisfies AudienceCondition;

const marketingEmailsLastTenDays = {
  attribute: "campaignEmailCount",
  _tag: "Condition",
  params: { purpose: "marketing", period: lastTenDays },
  operator: "eq",
  value: 0,
} as const satisfies AudienceCondition;

const lastVisitNotRecent = {
  attribute: "lastVisit",
  _tag: "Condition",
  operator: "notIn",
  value: { _tag: "Last", count: 30, unit: "day" },
} as const satisfies AudienceCondition;

const taggedVip = {
  attribute: "dotyposTags",
  _tag: "Condition",
  operator: "anyOf",
  value: ["vip"],
} as const satisfies AudienceCondition;

const speaks = (
  ...value: [AudienceCandidate["locale"], ...AudienceCandidate["locale"][]]
) =>
  ({
    attribute: "locale",
    _tag: "Condition",
    operator: "anyOf",
    value,
  }) as const satisfies AudienceCondition;

const noFacts: AudienceFacts = { counts: new Map(), dates: new Map() };

const countFacts = (
  request: AudienceCountRequest,
  counts: ReadonlyMap<DotyposCustomerId, number>
): AudienceFacts => ({
  counts: new Map([[audienceFactKey(request), counts]]),
  dates: new Map(),
});

const dateFacts = (
  request: AudienceDateRequest,
  facts: AudienceDateFacts
): AudienceFacts => ({
  counts: new Map(),
  dates: new Map([[audienceFactKey(request), facts]]),
});

const evaluate = (
  filter: AudienceFilter,
  options: {
    readonly facts?: AudienceFacts;
    readonly profile?: Option.Option<DotyposCustomer>;
    readonly context?: AudienceEvaluationContext;
  } = {}
) =>
  evaluateAudienceFilter({
    filter,
    candidate,
    context: options.context ?? context,
    facts: options.facts ?? noFacts,
    profile: options.profile ?? Option.none(),
  });

describe("compareCount", () => {
  test.each<[AudienceCountOperatorType, number, number, boolean]>([
    ["eq", 0, 0, true],
    ["eq", 1, 0, false],
    ["ne", 0, 0, false],
    ["ne", 2, 0, true],
    ["lt", 2, 3, true],
    ["lt", 3, 3, false],
    ["lte", 3, 3, true],
    ["lte", 4, 3, false],
    ["gt", 3, 3, false],
    ["gt", 4, 3, true],
    ["gte", 3, 3, true],
    ["gte", 2, 3, false],
  ])("%s: %i against %i is %p", (operator, actual, expected, result) => {
    expect(compareCount(operator, actual, expected)).toBe(result);
  });
});

describe("matchesSet", () => {
  test("any, all, and none of the chosen values", () => {
    expect(matchesSet("anyOf", ["a", "b"], ["b", "c"])).toBe(true);
    expect(matchesSet("anyOf", [], ["b"])).toBe(false);
    expect(matchesSet("allOf", ["a", "b"], ["a", "b"])).toBe(true);
    expect(matchesSet("allOf", ["a"], ["a", "b"])).toBe(false);
    expect(matchesSet("noneOf", ["a"], ["b"])).toBe(true);
    expect(matchesSet("noneOf", [], ["b"])).toBe(true);
    expect(matchesSet("noneOf", ["b"], ["b"])).toBe(false);
  });
});

describe("evaluateAudienceFilter", () => {
  test("leaves Dotypos conditions unknown until the profile is loaded", () => {
    expect(evaluate(taggedVip)).toBe("unknown");
    expect(evaluate(taggedVip, { profile: profile({ tags: ["vip"] }) })).toBe(
      "match"
    );
    expect(evaluate(taggedVip, { profile: profile({ tags: [] }) })).toBe(
      "noMatch"
    );
  });

  test("lets a local condition decide a group before hydration", () => {
    expect(evaluate(group("and", [speaks("cs-CZ"), taggedVip]))).toBe(
      "noMatch"
    );
    expect(evaluate(group("or", [speaks("en-US"), taggedVip]))).toBe("match");
  });

  test("treats an empty AND group as everyone and an empty OR group as nobody", () => {
    expect(evaluate(group("and", []))).toBe("match");
    expect(evaluate(group("or", []))).toBe("noMatch");
  });

  test("counts a customer without records as zero, so = 0 and < N match them", () => {
    expect(evaluate(marketingEmailsLastTenDays)).toBe("match");
    expect(
      evaluate({ ...marketingEmailsLastTenDays, operator: "lt", value: 2 })
    ).toBe("match");
    expect(evaluate(reservationsVisitedInMarch)).toBe("noMatch");
  });

  test("compares the resolved count of the condition's own request", () => {
    const facts = countFacts(
      countFactRequest(
        audienceAttributeCatalogue.campaignEmailCount,
        marketingEmailsLastTenDays,
        context
      ),
      new Map([[customerId, 1]])
    );
    expect(evaluate(marketingEmailsLastTenDays, { facts })).toBe("noMatch");
    // A different period is a different request, so its count is zero.
    expect(
      evaluate(
        {
          ...marketingEmailsLastTenDays,
          params: { purpose: "marketing", period: { _tag: "AnyTime" } },
        },
        { facts }
      )
    ).toBe("match");
  });

  test("a date in, not in, or without a value", () => {
    const request = dateFactRequest(lastVisitNotRecent, context);
    const visitedLongAgo = dateFacts(request, {
      withValue: new Set([customerId]),
      inPeriod: new Set(),
    });
    const visitedRecently = dateFacts(request, {
      withValue: new Set([customerId]),
      inPeriod: new Set([customerId]),
    });
    const neverVisited = dateFacts(request, {
      withValue: new Set(),
      inPeriod: new Set(),
    });
    const visitedIn = { ...lastVisitNotRecent, operator: "in" } as const;

    expect(evaluate(lastVisitNotRecent, { facts: visitedLongAgo })).toBe(
      "match"
    );
    expect(evaluate(lastVisitNotRecent, { facts: visitedRecently })).toBe(
      "noMatch"
    );
    // "Not in" needs a value: a customer who never visited doesn't match.
    expect(evaluate(lastVisitNotRecent, { facts: neverVisited })).toBe(
      "noMatch"
    );
    expect(evaluate(visitedIn, { facts: visitedRecently })).toBe("match");
    expect(evaluate(visitedIn, { facts: visitedLongAgo })).toBe("noMatch");

    const never = {
      attribute: "lastVisit",
      _tag: "Condition",
      operator: "none",
    } as const satisfies AudienceCondition;
    const anyTime = dateFactRequest(never, context);
    expect(
      evaluate(never, {
        facts: dateFacts(anyTime, {
          withValue: new Set(),
          inPeriod: new Set(),
        }),
      })
    ).toBe("match");
    expect(
      evaluate(never, {
        facts: dateFacts(anyTime, {
          withValue: new Set([customerId]),
          inPeriod: new Set([customerId]),
        }),
      })
    ).toBe("noMatch");
  });

  test("matches account presence, discount groups, and excluded tags", () => {
    expect(
      evaluate({
        attribute: "hasAccount",
        _tag: "Condition",
        operator: "is",
        value: false,
      })
    ).toBe("noMatch");
    const inGroup = {
      attribute: "discountGroup",
      _tag: "Condition",
      operator: "anyOf",
      value: ["42"],
    } as const satisfies AudienceCondition;
    expect(
      evaluate(inGroup, { profile: profile({ _discountGroupId: "42" }) })
    ).toBe("match");
    expect(evaluate(inGroup, { profile: profile({}) })).toBe("noMatch");
    expect(
      evaluate(
        { ...taggedVip, operator: "noneOf" },
        { profile: profile({ tags: ["regular"] }) }
      )
    ).toBe("match");
  });
});

describe("collectAudienceFactRequests", () => {
  test("requests each distinct count and date lookup once", () => {
    const requests = collectAudienceFactRequests(
      group("or", [
        reservationsVisitedInMarch,
        { ...reservationsVisitedInMarch, operator: "eq", value: 3 },
        marketingEmailsLastTenDays,
        lastVisitNotRecent,
        { ...lastVisitNotRecent, operator: "in" },
        { attribute: "lastVisit", _tag: "Condition", operator: "none" },
        group("and", [taggedVip, speaks("cs-CZ")]),
      ]),
      [context]
    );

    // Periods are fixed to their instants in the context.
    expect(requests.counts).toEqual([
      {
        attribute: "reservationCount",
        params: {
          dateBasis: "visit",
          period: {
            startsAtOrAfter: Temporal.Instant.from("2026-02-28T23:00:00Z"),
            startsBefore: Temporal.Instant.from("2026-03-31T22:00:00Z"),
          },
        },
      },
      {
        attribute: "campaignEmailCount",
        params: {
          purpose: "marketing",
          period: {
            startsAtOrAfter: Temporal.Instant.from("2026-10-05T10:00:00Z"),
            startsAtOrBefore: now,
          },
        },
      },
    ]);
    expect(requests.dates).toEqual([
      {
        attribute: "lastVisit",
        bounds: {
          startsAtOrAfter: Temporal.Instant.from("2026-09-15T10:00:00Z"),
          startsAtOrBefore: now,
        },
        asOf: now,
      },
      { attribute: "lastVisit", bounds: {}, asOf: now },
    ]);
  });

  test("shares a request between contexts only where their bounds agree", () => {
    const triggeredAt = (at: string): AudienceEvaluationContext => ({
      ...context,
      trigger: Option.some({
        kind: "schedule",
        at: Temporal.Instant.from(at),
        reservationId: Option.none(),
      }),
    });
    const afterTrigger = {
      attribute: "reservationCount",
      _tag: "Condition",
      params: {
        dateBasis: "visit",
        period: {
          _tag: "TriggerWindow",
          side: "after",
          count: 1,
          unit: "week",
        },
      },
      operator: "gt",
      value: 0,
    } as const satisfies AudienceCondition;
    const requests = collectAudienceFactRequests(
      group("and", [afterTrigger, marketingEmailsLastTenDays]),
      [
        triggeredAt("2026-10-01T08:00:00Z"),
        triggeredAt("2026-10-01T08:00:00Z"),
        triggeredAt("2026-10-08T08:00:00Z"),
      ]
    );
    // Two trigger windows, and one last-ten-days count for every context.
    expect(requests.counts.map(({ attribute }) => attribute)).toEqual([
      "reservationCount",
      "campaignEmailCount",
      "reservationCount",
    ]);
  });

  test("fixes a campaign source to the evaluating campaign", () => {
    const fromThisCampaign = {
      attribute: "campaignEmailCount",
      _tag: "Condition",
      params: {
        purpose: "any",
        period: { _tag: "AnyTime" },
        campaign: { _tag: "This" },
      },
      operator: "eq",
      value: 0,
    } as const satisfies AudienceCondition;
    const entry = audienceAttributeCatalogue.campaignEmailCount;
    const campaignId = campaignIdSchema.make("campaign-1");
    expect(
      countFactRequest(entry, fromThisCampaign, {
        ...context,
        campaignId: Option.some(campaignId),
      }).params.campaign
    ).toBe(campaignId);
    // Without a campaign of its own, "this campaign" sent nothing.
    expect(
      countFactRequest(entry, fromThisCampaign, context).params.campaign
    ).toBeNull();
    expect(
      countFactRequest(
        entry,
        {
          ...fromThisCampaign,
          params: {
            ...fromThisCampaign.params,
            campaign: {
              _tag: "Specific",
              campaignId: campaignIdSchema.make("campaign-2"),
            },
          },
        },
        context
      ).params.campaign
    ).toBe(campaignIdSchema.make("campaign-2"));
  });

  test("counts emails dispatched and reservations booked by a replayed moment", () => {
    const replayed = { ...context, replayed: true };
    const sinceMarch = { _tag: "Onward", date: "2026-03-01" } as const;
    const emailsSinceMarch = {
      ...marketingEmailsLastTenDays,
      params: { purpose: "marketing", period: sinceMarch },
    } as const satisfies AudienceCondition;
    const visitsSinceMarch = {
      ...reservationsVisitedInMarch,
      params: { dateBasis: "visit", period: sinceMarch },
    } as const satisfies AudienceCondition;
    const bookingsSinceMarch = {
      ...reservationsVisitedInMarch,
      params: { dateBasis: "booking", period: sinceMarch },
    } as const satisfies AudienceCondition;
    const march = Temporal.Instant.from("2026-02-28T23:00:00Z");
    const { campaignEmailCount, reservationCount } = audienceAttributeCatalogue;

    expect(
      countFactRequest(campaignEmailCount, emailsSinceMarch, replayed).params
        .period
    ).toEqual({ startsAtOrAfter: march, startsAtOrBefore: now });
    expect(
      countFactRequest(reservationCount, bookingsSinceMarch, replayed).params
        .period
    ).toEqual({ startsAtOrAfter: march, startsAtOrBefore: now });
    // The present has no later emails or bookings; visits may lie ahead
    // either way.
    expect(
      countFactRequest(campaignEmailCount, emailsSinceMarch, context).params
        .period
    ).toEqual({ startsAtOrAfter: march });
    expect(
      countFactRequest(reservationCount, bookingsSinceMarch, context).params
        .period
    ).toEqual({ startsAtOrAfter: march });
    expect(
      countFactRequest(reservationCount, visitsSinceMarch, replayed).params
        .period
    ).toEqual({ startsAtOrAfter: march });
  });

  test("counts and dates reservations as they stood at a replayed moment", () => {
    const replayed = { ...context, replayed: true };
    const { reservationCount, campaignEmailCount } = audienceAttributeCatalogue;
    const visitsAnyTime = {
      ...reservationsVisitedInMarch,
      params: { dateBasis: "visit", period: { _tag: "AnyTime" } },
    } as const satisfies AudienceCondition;
    const bookingsAnyTime = {
      ...visitsAnyTime,
      params: { dateBasis: "booking", period: { _tag: "AnyTime" } },
    } as const satisfies AudienceCondition;

    expect(
      countFactRequest(reservationCount, visitsAnyTime, replayed)
        .reservationsAsOf
    ).toEqual(now);
    expect(
      dateFactRequest(lastVisitNotRecent, replayed).reservationsAsOf
    ).toEqual(now);
    // Live evaluations count reservations as they are now.
    expect(
      countFactRequest(reservationCount, visitsAnyTime, context)
    ).not.toHaveProperty("reservationsAsOf");
    expect(dateFactRequest(lastVisitNotRecent, context)).not.toHaveProperty(
      "reservationsAsOf"
    );
    // Booking bounds end by the replayed moment, but statuses change later.
    expect(
      countFactRequest(reservationCount, bookingsAnyTime, replayed)
        .reservationsAsOf
    ).toEqual(now);
    // Email counts need only their occurrence bounds.
    expect(
      countFactRequest(campaignEmailCount, marketingEmailsLastTenDays, replayed)
    ).not.toHaveProperty("reservationsAsOf");
    // A live and a replayed evaluation at the same moment look up apart.
    expect(
      collectAudienceFactRequests(group("and", [visitsAnyTime]), [
        context,
        replayed,
      ]).counts
    ).toHaveLength(2);
  });
});

describe("audienceFilterSchema", () => {
  const decode = Schema.decodeUnknownResult(audienceFilterSchema);

  test("round-trips a nested filter of every attribute kind", () => {
    const filter = group("and", [
      reservationsVisitedInMarch,
      marketingEmailsLastTenDays,
      group("or", [
        lastVisitNotRecent,
        {
          attribute: "accountCreated",
          _tag: "Condition",
          operator: "in",
          value: { _tag: "Onward", date: "2026-09-01" },
        },
      ]),
      taggedVip,
      speaks("cs-CZ"),
      {
        attribute: "hasAccount",
        _tag: "Condition",
        operator: "is",
        value: true,
      },
    ]);
    const decoded = decode(filter);
    expect(Result.isSuccess(decoded)).toBe(true);
    expect(
      Schema.encodeSync(audienceFilterSchema)(Result.getOrThrow(decoded))
    ).toEqual(filter);
  });

  test.each([
    ["a negative count", { ...marketingEmailsLastTenDays, value: -1 }],
    ["a fractional count", { ...marketingEmailsLastTenDays, value: 1.5 }],
    [
      "a reversed date range",
      {
        ...reservationsVisitedInMarch,
        params: {
          dateBasis: "visit",
          period: { _tag: "Range", from: "2026-04-01", to: "2026-03-01" },
        },
      },
    ],
    [
      "a zero-length last period",
      { ...lastVisitNotRecent, value: { _tag: "Last", count: 0, unit: "day" } },
    ],
    ["an empty set", { ...taggedVip, value: [] }],
    [
      "a set operator the attribute lacks",
      { ...speaks("cs-CZ"), operator: "allOf" },
    ],
    [
      "an unknown attribute",
      { attribute: "spend", _tag: "Condition", operator: "gt", value: 1 },
    ],
    ["a legacy condition", { _tag: "Locale", locales: ["cs-CZ"] }],
  ])("rejects %s", (_, filter) => {
    expect(Result.isFailure(decode(filter))).toBe(true);
  });
});

describe("audienceLocales", () => {
  test("allows every locale without a locale condition", () => {
    expect([...audienceLocales(group("and", [taggedVip]))].sort()).toEqual([
      "cs-CZ",
      "en-US",
    ]);
  });

  test("narrows to the chosen locales, or to the others with none of", () => {
    expect([...audienceLocales(speaks("cs-CZ"))]).toEqual(["cs-CZ"]);
    expect([
      ...audienceLocales({ ...speaks("cs-CZ"), operator: "noneOf" }),
    ]).toEqual(["en-US"]);
  });

  test("intersects AND groups and unites OR groups at any depth", () => {
    expect([
      ...audienceLocales(
        group("and", [speaks("cs-CZ", "en-US"), group("or", [speaks("cs-CZ")])])
      ),
    ]).toEqual(["cs-CZ"]);
    expect(
      [...audienceLocales(group("or", [speaks("cs-CZ"), taggedVip]))].sort()
    ).toEqual(["cs-CZ", "en-US"]);
    expect([...audienceLocales(group("or", []))]).toEqual([]);
  });
});

describe("audienceSingleLocale", () => {
  test("finds the only locale a filter allows, and none otherwise", () => {
    expect(
      audienceSingleLocale(group("and", [taggedVip, speaks("en-US")]))
    ).toBe("en-US");
    expect(audienceSingleLocale(group("and", [taggedVip]))).toBeUndefined();
  });
});

describe("audienceAttributeCatalogue", () => {
  test("gives every attribute a kind the evaluator handles", () => {
    expect(
      Object.entries(audienceAttributeCatalogue).map(
        ([attribute, { kind }]) => [attribute, kind]
      )
    ).toEqual([
      ["reservationCount", "count"],
      ["firstVisit", "date"],
      ["lastVisit", "date"],
      ["campaignEmailCount", "count"],
      ["hasAccount", "boolean"],
      ["accountCreated", "date"],
      ["locale", "set"],
      ["dotyposTags", "set"],
      ["discountGroup", "set"],
    ]);
  });
});

describe("audienceFilterSchema product filters", () => {
  const decode = Schema.decodeUnknownResult(audienceFilterSchema);
  /** A product filter as untrusted input: any family, any property shape. */
  type ProductInput = {
    readonly family: string;
    readonly properties: readonly object[];
  };
  const withProduct = (product: ProductInput) => ({
    ...reservationsVisitedInMarch,
    params: { ...reservationsVisitedInMarch.params, product },
  });

  test.each([
    [
      "a current tier",
      {
        family: "cowork",
        properties: [
          { property: "tier", operator: "anyOf", value: ["reserved-desk"] },
        ],
      },
    ],
    [
      "a retired tier",
      {
        family: "cowork",
        properties: [
          { property: "tier", operator: "noneOf", value: ["profi"] },
        ],
      },
    ],
    [
      "a meeting-room offer",
      {
        family: "meeting-room",
        properties: [
          { property: "offer", operator: "anyOf", value: ["hour:4"] },
        ],
      },
    ],
    [
      "office seats",
      {
        family: "office",
        properties: [{ property: "seats", operator: "gte", value: 4 }],
      },
    ],
    ["a family alone", { family: "office", properties: [] }],
  ])("accepts %s", (_, product) => {
    expect(Result.isSuccess(decode(withProduct(product)))).toBe(true);
  });

  test.each([
    [
      "an unknown property",
      {
        family: "cowork",
        properties: [{ property: "seats", operator: "gte", value: 1 }],
      },
    ],
    [
      "an unknown value",
      {
        family: "cowork",
        properties: [{ property: "tier", operator: "anyOf", value: ["gold"] }],
      },
    ],
    [
      "an operator of another kind",
      {
        family: "cowork",
        properties: [{ property: "coffee", operator: "gte", value: 1 }],
      },
    ],
    ["an unknown family", { family: "garden", properties: [] }],
  ])("rejects %s", (_, product) => {
    expect(Result.isFailure(decode(withProduct(product)))).toBe(true);
    expect(
      Result.isFailure(
        decode({
          attribute: "lastVisit",
          _tag: "Condition",
          params: { product },
          operator: "none",
        })
      )
    ).toBe(true);
  });
});
