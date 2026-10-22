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
import { testEmailAddress } from "@deskohub/test-email";
import type {
  AudienceCountOperatorType,
  CampaignEmailSourceType,
  ReservationProductFilterType,
} from "@deskohub/workspace-admin-api";
import { Effect, Layer, Option } from "effect";
import { customerAccounts, workspaceReservations } from "@/db/schema";
import { authUser } from "@/db/schema/auth";
import type { ReservationStatusRead } from "@/features/administration/reservation-status-condition";
import { checkoutAttemptKeySchema } from "@/features/checkout/checkout-identifiers";
import {
  connectWorkspacePostgresTestDatabase,
  fixtureReservationAuthorId,
} from "@/shared/testing/workspace-postgres-test-database.test-utils";
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
  /** When the reservation was booked; 1 March unless given. */
  readonly bookedAt?: string;
  readonly details?: typeof plainCowork | typeof coffeeCowork;
};

/** The booking event a dry run replays. */
const replayedEvent = Temporal.Instant.from("2026-10-01T10:00:00Z");
const replayedAt = (
  at: Temporal.Instant = replayedEvent
): AudienceEvaluationContext => ({
  ...audienceEvaluationAt(at),
  replayed: true,
});

const firstVisitor = customerId("first-visitor");
/** Story 2: one visit two months ago and a booking next month. */
const counterexample = customerId("counterexample");
const lapsed = customerId("lapsed");
const recentlyBack = customerId("recently-back");
const lapsedWithBooking = customerId("lapsed-with-booking");
const mailed = customerId("mailed");
/** One visit booked before the replayed event and a second booked after. */
const bookedAfterEvent = customerId("booked-after-event");
/** A visit after the replayed event, booked before it. */
const bookedAheadOfEvent = customerId("booked-ahead-of-event");
/** A visit that began before it was booked, on the replayed event's day. */
const bookedOnTheDay = customerId("booked-on-the-day");
/** Two holds that expired unconfirmed, created before and after the event. */
const expiredHolder = customerId("expired-holder");
/** A checkout started before the event and confirmed after it, unfulfilled. */
const confirmedLater = customerId("confirmed-later");
/** On the replayed event's day: 08:00 is before it, 12:00 after. */
const onEventDay = (time: string) =>
  Temporal.Instant.from(`2026-10-01T${time}:00Z`);
/** Confirmed at 08:30 and fulfilled at 12:00. */
const fulfilledLater = customerId("fulfilled-later");
/** Confirmed at 08:30, unfulfilled, and cancelled at 12:00. */
const cancelledLater = customerId("cancelled-later");
/** A hold the cleanup cancelled when it expired at 11:00. */
const holdLapsedLater = customerId("hold-lapsed-later");
/** A legacy expired hold, due at 11:00. */
const holdExpiredLater = customerId("hold-expired-later");
/** Confirmed at 08:30; its fulfillment email failed at 12:00. */
const failedLater = customerId("failed-later");
/** Confirmed at 08:30; a cancellation failed at 12:00, undated. */
const cancellationFailedLater = customerId("cancellation-failed-later");
/** Its fulfillment failed at 09:00 and was retried at 12:00, undated. */
const retriedLater = customerId("retried-later");
/** Its fulfillment email failed at 09:00 and was delivered at 11:00. */
const recoveredLater = customerId("recovered-later");
const transitionedLater = [
  fulfilledLater,
  cancelledLater,
  holdLapsedLater,
  holdExpiredLater,
  failedLater,
  cancellationFailedLater,
  retriedLater,
  recoveredLater,
];
const confirmedOnEventDay = {
  reservationConfirmedAt: onEventDay("08:30"),
  paymentState: "paid" as const,
  paidAt: onEventDay("08:30"),
  fulfillmentState: "not_started" as const,
};
const transitionedReservations = [
  {
    customer: fulfilledLater,
    reservationState: "confirmed" as const,
    ...confirmedOnEventDay,
    fulfillmentState: "fulfilled" as const,
    fulfilledAt: onEventDay("12:00"),
  },
  {
    customer: cancelledLater,
    reservationState: "cancelled" as const,
    ...confirmedOnEventDay,
    reservationCancelledAt: onEventDay("12:00"),
  },
  {
    customer: holdLapsedLater,
    reservationState: "cancelled" as const,
    reservationHoldExpiresAt: onEventDay("11:00"),
    reservationHoldExpiredAt: onEventDay("11:00"),
    reservationCancelledAt: onEventDay("11:00"),
    paymentState: "expired" as const,
    fulfillmentState: "not_started" as const,
  },
  {
    customer: holdExpiredLater,
    reservationState: "hold_expired" as const,
    reservationHoldExpiresAt: onEventDay("11:00"),
    paymentState: "expired" as const,
    fulfillmentState: "not_started" as const,
  },
  {
    customer: failedLater,
    reservationState: "confirmed" as const,
    ...confirmedOnEventDay,
    fulfillmentState: "failed" as const,
    fulfillmentFailedAt: onEventDay("12:00"),
    fulfillmentFailureCode: "fulfillment_email_failed",
  },
  {
    customer: cancellationFailedLater,
    reservationState: "cancellation_failed" as const,
    ...confirmedOnEventDay,
    updatedAt: onEventDay("12:00"),
  },
  {
    customer: retriedLater,
    reservationState: "confirmed" as const,
    ...confirmedOnEventDay,
    fulfillmentState: "processing" as const,
    fulfillmentFailedAt: onEventDay("09:00"),
    fulfillmentFailureCode: "fulfillment_email_failed",
    updatedAt: onEventDay("12:00"),
  },
  {
    customer: recoveredLater,
    reservationState: "confirmed" as const,
    ...confirmedOnEventDay,
    fulfillmentState: "fulfilled" as const,
    fulfilledAt: onEventDay("11:00"),
    fulfillmentFailedAt: onEventDay("09:00"),
    updatedAt: onEventDay("11:00"),
  },
];

/** An account created two hours after the replayed event. */
const accountHolder = customerId("account-holder");
const accountId = `resolver-account-${run}`;
const accountCreatedAt = Temporal.Instant.from("2026-10-01T12:00:00Z");
const statusedReservations = [
  {
    name: "expired-before-event",
    customer: expiredHolder,
    createdAt: "2026-09-25T10:00:00Z",
  },
  {
    name: "expired-after-event",
    customer: expiredHolder,
    createdAt: "2026-10-05T10:00:00Z",
  },
  {
    name: "confirmed-after-event",
    customer: confirmedLater,
    createdAt: "2026-09-30T10:00:00Z",
    confirmedAt: "2026-10-02T10:00:00Z",
  },
];

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
  ...[bookedAfterEvent, bookedAheadOfEvent].map((customer) => ({
    name: `${customer}-september`,
    customer,
    startsAt: "2026-09-10T08:00:00Z",
    bookedAt: "2026-09-01T10:00:00Z",
  })),
  {
    name: "booked-five-days-later",
    customer: bookedAfterEvent,
    startsAt: "2026-10-08T08:00:00Z",
    bookedAt: "2026-10-06T10:00:00Z",
  },
  {
    name: "booked-ahead",
    customer: bookedAheadOfEvent,
    startsAt: "2026-10-08T08:00:00Z",
    bookedAt: "2026-09-20T10:00:00Z",
  },
  {
    name: "booked-on-the-day",
    customer: bookedOnTheDay,
    startsAt: "2026-10-01T08:00:00Z",
    bookedAt: "2026-10-01T10:00:00Z",
  },
];

const seeded = [
  firstVisitor,
  counterexample,
  lapsed,
  recentlyBack,
  lapsedWithBooking,
  mailed,
  bookedAfterEvent,
  bookedAheadOfEvent,
  bookedOnTheDay,
  expiredHolder,
  confirmedLater,
  ...transitionedLater,
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
          bookings.map(({ name, customer, bookedAt, details }) => ({
            authorAccountId: fixtureReservationAuthorId,
            checkoutAttemptKey: checkoutAttemptKeySchema.make(
              `resolver-${name}-${run}`
            ),
            dotyposCustomerId: customer,
            dotyposReservationId: reservationId(name),
            reservationState: "confirmed" as const,
            reservationConfirmedAt: Temporal.Instant.from(
              bookedAt ?? "2026-03-01T10:00:00Z"
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
      await Effect.runPromise(
        db.insert(workspaceReservations).values(
          statusedReservations.map(
            ({ name, customer, createdAt, confirmedAt }) => ({
              authorAccountId: fixtureReservationAuthorId,
              checkoutAttemptKey: checkoutAttemptKeySchema.make(
                `resolver-${name}-${run}`
              ),
              dotyposCustomerId: customer,
              ...(confirmedAt
                ? {
                    dotyposReservationId: reservationId(name),
                    reservationState: "confirmed" as const,
                    reservationConfirmedAt: Temporal.Instant.from(confirmedAt),
                    paymentState: "paid" as const,
                    paidAt: Temporal.Instant.from(confirmedAt),
                  }
                : {
                    reservationState: "hold_expired" as const,
                    paymentState: "expired" as const,
                  }),
              fulfillmentState: "not_started" as const,
              reservationDetails: plainCowork,
              locale: "cs-CZ" as const,
              createdAt: Temporal.Instant.from(createdAt),
            })
          )
        )
      );
      await Effect.runPromise(
        db.insert(workspaceReservations).values(
          transitionedReservations.map(({ customer, ...states }) => ({
            authorAccountId: fixtureReservationAuthorId,
            checkoutAttemptKey: checkoutAttemptKeySchema.make(
              `resolver-${customer}`
            ),
            dotyposCustomerId: customer,
            dotyposReservationId: reservationId(customer),
            reservationDetails: plainCowork,
            locale: "cs-CZ" as const,
            createdAt: onEventDay("08:00"),
            ...states,
          }))
        )
      );
      await Effect.runPromise(
        db.insert(customerAccounts).values({
          id: accountId,
          dotyposCustomerId: accountHolder,
          createdAt: accountCreatedAt,
        })
      );
      await Effect.runPromise(
        db.insert(authUser).values({
          id: accountId,
          name: "Resolver test",
          email: testEmailAddress(`resolver-${run}`),
          emailVerified: true,
          locale: "cs-CZ",
          // An earlier login doesn't count; the resolver reads the account's date.
          createdAt: new Date(
            accountCreatedAt.subtract({ hours: 30 * 24 }).epochMilliseconds
          ),
        })
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
      await testDatabase.pool.query('delete from auth."user" where id = $1', [
        accountId,
      ]);
      await testDatabase.pool.query(
        "delete from customer_accounts where id = $1",
        [accountId]
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

    test("a replay counts the visits booked by its event, wherever they lie", async () => {
      const replay = [bookedAfterEvent, bookedAheadOfEvent];
      const twoVisits = visitCount({ _tag: "AnyTime" }, "gte", 2);
      // The second reservation was booked five days after the event.
      expect(await matching(twoVisits, replay, replayedAt())).toEqual([
        bookedAheadOfEvent,
      ]);
      expect(await matching(twoVisits, replay)).toEqual(replay);
      // A booking counts from its own moment, as its booked event does.
      expect(
        await matching(
          twoVisits,
          replay,
          replayedAt(Temporal.Instant.from("2026-10-06T10:00:00Z"))
        )
      ).toEqual(replay);
      // Bounded visit periods, past or ahead of the event, count the same way.
      expect(
        await matching(
          visitCount({ _tag: "Onward", date: "2026-10-02" }, "gte", 1),
          replay,
          replayedAt()
        )
      ).toEqual([bookedAheadOfEvent]);
      expect(
        await matching(
          visitCount(
            { _tag: "Range", from: "2026-09-01", to: "2026-10-31" },
            "gte",
            2
          ),
          replay,
          replayedAt()
        )
      ).toEqual([bookedAheadOfEvent]);
    });

    test("a replay counts a reservation of a status from its creation", async () => {
      const visitsWith = (
        status: "cancelled" | "in_progress",
        operator: AudienceCountOperatorType,
        value: number
      ) =>
        condition({
          attribute: "reservationCount",
          params: { dateBasis: "visit", period: { _tag: "AnyTime" }, status },
          operator,
          value,
        });
      // A hold that never confirmed existed from its creation.
      const expiredOnce = visitsWith("cancelled", "eq", 1);
      expect(
        await matching(expiredOnce, [expiredHolder], replayedAt())
      ).toEqual([expiredHolder]);
      expect(await matching(expiredOnce, [expiredHolder])).toEqual([]);
      // So did a checkout in progress then, confirmed since.
      expect(
        await matching(
          visitsWith("in_progress", "gte", 1),
          [confirmedLater],
          replayedAt()
        )
      ).toEqual([confirmedLater]);
      // Booked, though, it counts from its confirmation.
      expect(
        await matching(
          visitCount({ _tag: "AnyTime" }, "gte", 1),
          [confirmedLater],
          replayedAt()
        )
      ).toEqual([]);
    });

    test("a replay dates only the visits booked by its event", async () => {
      const visitedThatDay = condition({
        attribute: "lastVisit",
        operator: "in",
        value: { _tag: "Range", from: "2026-10-01", to: "2026-10-01" },
      });
      const nineOClock = Temporal.Instant.from("2026-10-01T09:00:00Z");
      expect(
        await matching(visitedThatDay, [bookedOnTheDay], replayedAt(nineOClock))
      ).toEqual([]);
      expect(
        await matching(visitedThatDay, [bookedOnTheDay], replayedAt())
      ).toEqual([bookedOnTheDay]);
    });

    test("a replay reads each reservation's status as its timestamps date it then", async () => {
      const inStatus = (status: "complete" | "cancelled" | "in_progress") =>
        condition({
          attribute: "reservationCount",
          params: { dateBasis: "visit", period: { _tag: "AnyTime" }, status },
          operator: "gte",
          value: 1,
        });
      const bookedBy = (dateBasis: "visit" | "booking") =>
        condition({
          attribute: "reservationCount",
          params: { dateBasis, period: { _tag: "AnyTime" } },
          operator: "gte",
          value: 1,
        });
      const dated = [fulfilledLater, cancelledLater, holdLapsedLater];
      const atTen = replayedAt();
      const atOne = replayedAt(onEventDay("13:00"));

      // At 10:00 none of the later transitions had happened yet.
      expect(await matching(inStatus("complete"), dated, atTen)).toEqual([]);
      expect(await matching(inStatus("cancelled"), dated, atTen)).toEqual([]);
      expect(
        await matching(inStatus("in_progress"), transitionedLater, atTen)
      ).toEqual([
        fulfilledLater,
        cancelledLater,
        holdLapsedLater,
        holdExpiredLater,
        failedLater,
        // Failed then, but its retry is undated, so it reads as it is now.
        retriedLater,
        // Failed then; recovered since, so it reads in progress and is flagged.
        recoveredLater,
      ]);
      // By visit or by booking, the reservation cancelled at 12:00 was booked.
      for (const dateBasis of ["visit", "booking"] as const) {
        expect(
          await matching(bookedBy(dateBasis), [cancelledLater], atTen)
        ).toEqual([cancelledLater]);
        expect(
          await matching(bookedBy(dateBasis), [cancelledLater], atOne)
        ).toEqual([]);
      }

      // At 13:00 they had.
      expect(await matching(inStatus("complete"), dated, atOne)).toEqual([
        fulfilledLater,
      ]);
      expect(
        await matching(inStatus("cancelled"), transitionedLater, atOne)
      ).toEqual([cancelledLater, holdLapsedLater, holdExpiredLater]);
      expect(
        await matching(inStatus("in_progress"), transitionedLater, atOne)
      ).toEqual([retriedLater]);
    });

    test("reports when a reservation's status changed in a way a replay can't date", async () => {
      const undated = (statuses: readonly ReservationStatusRead[]) =>
        Effect.runPromise(
          CampaignCandidateRepository.pipe(
            Effect.flatMap((candidates) =>
              candidates.undatedStatusChanges({
                statuses: new Set(statuses),
                customers: transitionedLater,
              })
            ),
            Effect.provide(CampaignCandidateRepository.Default),
            Effect.provide(testDatabase.layer)
          )
        ).then((changes) =>
          Object.fromEntries(
            [...changes].map(([id, changedAt]) => [id, changedAt.toString()])
          )
        );
      const noon = onEventDay("12:00").toString();
      // The failed cancellation is dated only by the row's last update.
      expect(await undated(["booked"])).toEqual({
        [cancellationFailedLater]: noon,
      });
      // The failure may have followed a fulfillment it erased, and the
      // retry of a failure is dated only by the row's last update.
      expect(await undated(["complete"])).toEqual({
        [cancellationFailedLater]: noon,
        [failedLater]: noon,
        [retriedLater]: noon,
        // The 11:00 recovery that kept the failure's time is dated by that update.
        [recoveredLater]: onEventDay("11:00").toString(),
      });
      expect(await undated(["needs_refund"])).toEqual({});
    });

    test("a replay knows only the accounts created by its moment", async () => {
      const hadAccount = condition({
        attribute: "accountCreated",
        operator: "in",
        value: { _tag: "AnyTime" },
      });
      const noAccount = condition({
        attribute: "accountCreated",
        operator: "none",
      });
      // The account was created at 12:00, two hours after the event.
      expect(await matching(hadAccount, [accountHolder], replayedAt())).toEqual(
        []
      );
      expect(await matching(noAccount, [accountHolder], replayedAt())).toEqual([
        accountHolder,
      ]);
      const afterCreation = replayedAt(accountCreatedAt.add({ hours: 1 }));
      expect(
        await matching(hadAccount, [accountHolder], afterCreation)
      ).toEqual([accountHolder]);
      expect(await matching(noAccount, [accountHolder], afterCreation)).toEqual(
        []
      );
      expect(await matching(hadAccount, [accountHolder])).toEqual([
        accountHolder,
      ]);
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
