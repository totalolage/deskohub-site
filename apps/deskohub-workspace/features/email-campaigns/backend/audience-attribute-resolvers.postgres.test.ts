import "@/shared/testing/workspace-test-env";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  type DotyposCustomerId,
  DotyposCustomerIdSchema,
  type DotyposReservation,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import {
  DotyposServiceMock,
  seededReservationReads,
} from "@deskohub/dotypos/backend/service.mock";
import type {
  AudienceCountOperatorType,
  CampaignEmailSourceType,
  ReservationProductFilterType,
} from "@deskohub/workspace-admin-api";
import { Effect, Layer, Option } from "effect";
import { workspaceReservations } from "@/db/schema";
import { checkoutAttemptKeySchema } from "@/features/checkout/checkout-identifiers";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import type {
  AudienceCondition,
  AudienceFacts,
  AudienceFilter,
} from "../audience-filter";
import { campaignIdSchema } from "../campaign-identifiers";
import type { DatePeriod } from "../date-period";
import { evaluateAudienceFilter } from "./audience-evaluation";
import {
  type AudienceEvaluationContext,
  AudienceScope,
  audienceEvaluationAt,
} from "./audience-evaluation-context";
import { AudienceFactsService } from "./audience-facts.service";
import { CampaignCandidateRepository } from "./campaign-candidate.repository";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const run = crypto.randomUUID();
/** 12:00 in Prague (CEST). */
const now = Temporal.Instant.from("2026-10-15T10:00:00Z");
const context = audienceEvaluationAt(now);

const customerId = (role: string) =>
  DotyposCustomerIdSchema.make(`resolver-${role}-${run}`);
const reservationId = (name: string) =>
  DotyposReservationIdSchema.make(`resolver-${name}-${run}`);

const plainCowork = { kind: "cowork", entryTier: "open-space", coffee: false };
const coffeeCowork = { kind: "cowork", entryTier: "open-space", coffee: true };
const withCoffee: ReservationProductFilterType = {
  family: "cowork",
  properties: [{ property: "coffee", operator: "is", value: true }],
};

/** One booked Workspace reservation and its Dotypos visit. */
type Booking = {
  readonly name: string;
  readonly customer: DotyposCustomerId;
  readonly startsAt: string;
  readonly details?: typeof plainCowork | typeof coffeeCowork;
};

const firstVisitor = customerId("first-visitor");
/** Story 2: one visit two months ago and a booking next month. */
const counterexample = customerId("counterexample");
const lapsed = customerId("lapsed");
const recentlyBack = customerId("recently-back");
const lapsedWithBooking = customerId("lapsed-with-booking");
const mailed = customerId("mailed");

const bookings: readonly Booking[] = [
  {
    name: "first-plain",
    customer: firstVisitor,
    startsAt: "2026-04-01T08:00:00Z",
  },
  {
    name: "first-coffee",
    customer: firstVisitor,
    startsAt: "2026-06-01T08:00:00Z",
    details: coffeeCowork,
  },
  {
    name: "first-upcoming",
    customer: firstVisitor,
    startsAt: "2026-11-01T08:00:00Z",
    details: coffeeCowork,
  },
  {
    name: "counter-visit",
    customer: counterexample,
    startsAt: "2026-08-15T08:00:00Z",
  },
  {
    name: "counter-booking",
    customer: counterexample,
    startsAt: "2026-11-15T08:00:00Z",
  },
  ...[lapsed, recentlyBack, lapsedWithBooking].flatMap((customer) => [
    {
      name: `${customer}-july`,
      customer,
      startsAt: "2026-07-15T08:00:00Z",
    },
    {
      name: `${customer}-august`,
      customer,
      startsAt: "2026-08-15T08:00:00Z",
    },
  ]),
  {
    name: "recent-visit",
    customer: recentlyBack,
    startsAt: "2026-10-05T08:00:00Z",
  },
  {
    name: "lapsed-booking",
    customer: lapsedWithBooking,
    startsAt: "2026-11-15T08:00:00Z",
  },
];

const seeded = [
  firstVisitor,
  counterexample,
  lapsed,
  recentlyBack,
  lapsedWithBooking,
  mailed,
];

const visits: readonly DotyposReservation[] = bookings.map(
  ({ name, customer, startsAt }) =>
    ({
      id: reservationId(name),
      _customerId: customer,
      startDate: startsAt,
      endDate: Temporal.Instant.from(startsAt).add({ hours: 2 }).toString(),
    }) as DotyposReservation
);

const scoped = [firstVisitor, counterexample, mailed];
const campaignA = campaignIdSchema.make(`resolver-campaign-a-${run}`);
const campaignB = campaignIdSchema.make(`resolver-campaign-b-${run}`);
const sendA = `resolver-send-a-${run}`;
const sendB = `resolver-send-b-${run}`;

type ConditionFields = AudienceCondition extends infer Condition
  ? Condition extends unknown
    ? Omit<Condition, "_tag">
    : never
  : never;

const condition = (fields: ConditionFields) =>
  ({ _tag: "Condition", ...fields }) as AudienceCondition;
const group = (
  operator: "and" | "or",
  filters: readonly AudienceFilter[]
): AudienceFilter => ({ _tag: "Group", operator, filters });

const visitCount = (
  period: DatePeriod,
  operator: AudienceCountOperatorType,
  value: number
) =>
  condition({
    attribute: "reservationCount",
    params: { dateBasis: "visit", period },
    operator,
    value,
  });

const firstVisitIn = (
  from: string,
  to: string,
  product?: ReservationProductFilterType
) =>
  condition({
    attribute: "firstVisit",
    ...(product && { params: { product } }),
    operator: "in",
    value: { _tag: "Range", from, to },
  });

const emailsFrom = (campaign?: CampaignEmailSourceType) =>
  condition({
    attribute: "campaignEmailCount",
    params: {
      purpose: "any",
      period: { _tag: "AnyTime" },
      ...(campaign && { campaign }),
    },
    operator: "gte",
    value: 1,
  });

/** Story 2's "Lapsed regulars": two visits so far, none in the last month. */
const lapsedRegulars = group("and", [
  visitCount({ _tag: "Past" }, "gte", 2),
  visitCount({ _tag: "Last", count: 1, unit: "month" }, "eq", 0),
]);

/** A filter that touches every local and visit fact source. */
const everyFact = group("or", [
  lapsedRegulars,
  firstVisitIn("2026-04-01", "2026-04-30"),
  firstVisitIn("2026-06-01", "2026-06-30", withCoffee),
  condition({
    attribute: "lastVisit",
    operator: "notIn",
    value: { _tag: "Last", count: 30, unit: "day" },
  }),
  visitCount({ _tag: "AnyTime" }, "gt", 0),
  visitCount({ _tag: "Onward", date: "2026-11-01" }, "gt", 0),
  emailsFrom(),
  emailsFrom({ _tag: "Specific", campaignId: campaignA }),
  emailsFrom({ _tag: "This" }),
  condition({ attribute: "accountCreated", operator: "none" }),
]);

describe.skipIf(!testDatabase)(
  "audience attribute resolvers on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const { db } = testDatabase;

    beforeAll(async () => {
      await Effect.runPromise(
        db.insert(workspaceReservations).values(
          bookings.map(({ name, customer, details }) => ({
            checkoutAttemptKey: checkoutAttemptKeySchema.make(
              `resolver-${name}-${run}`
            ),
            dotyposCustomerId: customer,
            dotyposReservationId: reservationId(name),
            reservationState: "confirmed" as const,
            reservationConfirmedAt: Temporal.Instant.from(
              "2026-03-01T10:00:00Z"
            ),
            paymentState: "paid" as const,
            paidAt: Temporal.Instant.from("2026-03-01T10:00:00Z"),
            fulfillmentState: "fulfilled" as const,
            fulfilledAt: Temporal.Instant.from("2026-03-01T10:00:00Z"),
            reservationDetails: details ?? plainCowork,
            locale: "cs-CZ" as const,
            createdAt: Temporal.Instant.from("2026-03-01T10:00:00Z"),
          }))
        )
      );
      const filter = JSON.stringify(group("and", []));
      await testDatabase.pool.query(
        `insert into email_campaigns (id, title, purpose, template_key, status)
         values ($1, 'A', 'marketing', 'workspace', 'sent'),
                ($2, 'B', 'operational', 'workspace', 'sent')`,
        [campaignA, campaignB]
      );
      await testDatabase.pool.query(
        `insert into email_campaign_sends (id, campaign_id, audience_filter, content_hash, delivery_attempt)
         values ($1, $2, $5, 'hash', 1), ($3, $4, $5, 'hash', 1)`,
        [sendA, campaignA, sendB, campaignB, filter]
      );
      await testDatabase.pool.query(
        `insert into email_campaign_recipients (send_id, dotypos_customer_id, locale, status, delivery_attempt, status_updated_at)
         values ($1, $3, 'cs-CZ', 'delivered', 1, '2026-10-01T11:00:00Z'),
                ($2, $3, 'cs-CZ', 'delivered', 1, '2026-10-02T11:00:00Z'),
                ($2, $4, 'cs-CZ', 'delivered', 1, '2026-10-02T11:00:00Z')`,
        [sendA, sendB, mailed, lapsed]
      );
    });

    afterAll(async () => {
      await testDatabase.pool.query(
        "delete from email_campaign_sends where id = any($1)",
        [[sendA, sendB]]
      );
      await testDatabase.pool.query(
        "delete from email_campaigns where id = any($1)",
        [[campaignA, campaignB]]
      );
      await testDatabase.pool.query(
        "delete from workspace_reservations where dotypos_customer_id = any($1)",
        [seeded]
      );
    });

    const resolve = (input: {
      readonly filter: AudienceFilter;
      readonly contexts?: readonly AudienceEvaluationContext[];
      readonly scope?: AudienceScope;
    }) =>
      Effect.runPromise(
        AudienceFactsService.pipe(
          Effect.flatMap((facts) =>
            facts.resolve({
              filter: input.filter,
              contexts: input.contexts ?? [context],
              ...(input.scope && { scope: input.scope }),
            })
          )
        ).pipe(
          Effect.provide(
            AudienceFactsService.Default.pipe(
              Layer.provide(
                Layer.mergeAll(
                  CampaignCandidateRepository.Default.pipe(
                    Layer.provide(testDatabase.layer)
                  ),
                  DotyposServiceMock(seededReservationReads(visits))
                )
              )
            )
          )
        )
      );

    /** The customers the filter matches among `customers`. */
    const matching = async (
      filter: AudienceFilter,
      customers: readonly DotyposCustomerId[],
      evaluation: AudienceEvaluationContext = context
    ) => {
      const facts = await resolve({ filter, contexts: [evaluation] });
      return customers.filter(
        (dotyposCustomerId) =>
          evaluateAudienceFilter({
            filter,
            candidate: {
              dotyposCustomerId,
              locale: "cs-CZ",
              hasAccount: false,
            },
            context: evaluation,
            facts,
            profile: Option.none(),
          }) === "match"
      );
    };

    /** Facts limited to some customers, in a comparable shape. */
    const factsOf = (
      { counts, dates }: AudienceFacts,
      customers: readonly DotyposCustomerId[]
    ) => ({
      counts: [...counts].map(([key, byCustomer]) => [
        key,
        customers.map((id) => byCustomer.get(id) ?? 0),
      ]),
      dates: [...dates].map(([key, { withValue, inPeriod }]) => [
        key,
        customers.map((id) => [withValue.has(id), inPeriod.has(id)]),
      ]),
    });

    test("dates the first visit by the earliest booked visit that has begun", async () => {
      expect(
        await matching(firstVisitIn("2026-04-01", "2026-04-30"), seeded)
      ).toEqual([firstVisitor]);
      // An upcoming booking is no visit yet.
      expect(
        await matching(firstVisitIn("2026-11-01", "2026-11-30"), seeded)
      ).toEqual([]);
    });

    test("dates the first visit of a product by that product's visits", async () => {
      expect(
        await matching(
          firstVisitIn("2026-06-01", "2026-06-30", withCoffee),
          seeded
        )
      ).toEqual([firstVisitor]);
      expect(
        await matching(
          firstVisitIn("2026-04-01", "2026-04-30", withCoffee),
          seeded
        )
      ).toEqual([]);
    });

    test("counts the emails of one campaign, or of the evaluating campaign", async () => {
      expect(await matching(emailsFrom(), seeded)).toEqual([lapsed, mailed]);
      expect(
        await matching(
          emailsFrom({ _tag: "Specific", campaignId: campaignA }),
          seeded
        )
      ).toEqual([mailed]);
      expect(
        await matching(emailsFrom({ _tag: "This" }), seeded, {
          ...context,
          campaignId: Option.some(campaignB),
        })
      ).toEqual([lapsed, mailed]);
      // Without a campaign of its own, "this campaign" sent nobody anything.
      expect(await matching(emailsFrom({ _tag: "This" }), seeded)).toEqual([]);
    });

    test("story 2: lapsed regulars have two visits so far and none in the last month", async () => {
      const story = [counterexample, lapsed, recentlyBack, lapsedWithBooking];
      // The counterexample's upcoming booking isn't a visit, and a booking
      // next month isn't a visit in the last month.
      expect(await matching(lapsedRegulars, story)).toEqual([
        lapsed,
        lapsedWithBooking,
      ]);
      // Any time counts upcoming bookings too, which is why the audience
      // counts visits so far.
      expect(
        await matching(
          group("and", [
            visitCount({ _tag: "AnyTime" }, "gte", 2),
            visitCount({ _tag: "Last", count: 1, unit: "month" }, "eq", 0),
          ]),
          story
        )
      ).toEqual([counterexample, lapsed, lapsedWithBooking]);
    });

    test("gives a customer scope the same facts as everyone", async () => {
      const everyone = await resolve({ filter: everyFact });
      const someone = await resolve({
        filter: everyFact,
        scope: AudienceScope.Customers({ ids: scoped }),
      });
      expect(factsOf(someone, scoped)).toEqual(factsOf(everyone, scoped));
      expect(factsOf(everyone, scoped)).not.toEqual(
        factsOf({ counts: new Map(), dates: new Map() }, scoped)
      );
    });
  }
);
