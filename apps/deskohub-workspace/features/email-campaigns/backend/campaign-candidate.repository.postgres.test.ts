import "@/shared/testing/workspace-test-env";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { testEmailAddress } from "@deskohub/test-email";
import {
  type AudienceCountCondition,
  audienceAttributeCatalogue,
} from "@deskohub/workspace-admin-api";
import { Effect, Option } from "effect";
import {
  customerAccountLinks,
  customerAccounts,
  customerMarketingConsents,
  workspaceReservations,
} from "@/db/schema";
import { authUser } from "@/db/schema/auth";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import { checkoutAttemptKeySchema } from "@/features/checkout/checkout-identifiers";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  type AudienceCondition,
  audienceFactKey,
  countFactRequest,
} from "../audience-filter";
import type { CampaignId } from "../campaign-identifiers";
import type { DatePeriodBounds } from "../date-period";
import { evaluateAudienceFilter } from "./audience-evaluation";
import { audienceEvaluationAt } from "./audience-evaluation-context";
import {
  CampaignCandidateRepository,
  type CampaignReservationSelection,
  listCampaignCandidateIds,
} from "./campaign-candidate.repository";
import {
  deleteAutomatedCampaigns,
  seedAutomatedCampaign,
  seedAutomatedSend,
  seedAutomationVersion,
} from "./email-campaigns.test-utils";

const testDatabase = await connectWorkspacePostgresTestDatabase();
const context = audienceEvaluationAt(Temporal.Now.instant());

const run = crypto.randomUUID();
const customerId = (role: string) =>
  DotyposCustomerIdSchema.make(`campaign-${role}-${run}`);
const reserved = customerId("reserved");
const abandoned = customerId("abandoned");
const unfulfilled = customerId("unfulfilled");
const linked = customerId("linked");
const unverifiedLinked = customerId("unverified-linked");
const consented = customerId("consented");
const withdrawn = customerId("withdrawn");
const seeded = [
  reserved,
  abandoned,
  unfulfilled,
  linked,
  unverifiedLinked,
  consented,
  withdrawn,
];
const visitedReservation = DotyposReservationIdSchema.make(`booking-${run}`);
const abandonedReservation = DotyposReservationIdSchema.make(
  `abandoned-${run}`
);
const accountId = `campaign-account-${run}`;
const unverifiedAccountId = `campaign-unverified-account-${run}`;
/** 23:50 on March 10 in Prague. */
const createdAt = Temporal.Instant.from("2026-03-10T22:50:00Z");
/** 00:30 on March 11 in Prague. */
const confirmedAt = Temporal.Instant.from("2026-03-10T23:30:00Z");
/** Booking-date bounds of one Prague calendar day (CET, UTC+1). */
const bookedOnPragueDay = (day: string) => ({
  booked: {
    startsAtOrAfter: Temporal.PlainDate.from(day)
      .toZonedDateTime("Europe/Prague")
      .toInstant(),
    startsBefore: Temporal.PlainDate.from(day)
      .add({ days: 1 })
      .toZonedDateTime("Europe/Prague")
      .toInstant(),
  },
});
const accountCreatedAt = Temporal.Instant.from("2026-09-15T10:00:00Z");
const marketingCampaign = `campaign-marketing-${run}`;
const operationalCampaign = `campaign-operational-${run}`;
const marketingSend = `send-marketing-${run}`;
const operationalSend = `send-operational-${run}`;
const reservationDetails = {
  kind: "cowork",
  entryTier: "open-space",
  coffee: false,
} as const;

describe.skipIf(!testDatabase)(
  "CampaignCandidateRepository on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const { db } = testDatabase;

    beforeAll(async () => {
      await Effect.runPromise(
        Effect.all([
          db.insert(workspaceReservations).values([
            {
              checkoutAttemptKey: checkoutAttemptKeySchema.make(`old-${run}`),
              dotyposCustomerId: reserved,
              dotyposReservationId: DotyposReservationIdSchema.make(
                `old-booking-${run}`
              ),
              reservationState: "cancelled",
              paymentState: "cancelled",
              fulfillmentState: "not_started",
              reservationDetails,
              locale: "cs-CZ",
              createdAt: createdAt.subtract({ hours: 240 }),
            },
            {
              checkoutAttemptKey: checkoutAttemptKeySchema.make(`new-${run}`),
              dotyposCustomerId: reserved,
              dotyposReservationId: visitedReservation,
              reservationState: "confirmed",
              reservationConfirmedAt: confirmedAt,
              paymentState: "paid",
              paidAt: confirmedAt,
              fulfillmentState: "fulfilled",
              fulfilledAt: confirmedAt,
              reservationDetails,
              locale: "en-US",
              createdAt,
            },
            {
              checkoutAttemptKey: checkoutAttemptKeySchema.make(
                `abandoned-${run}`
              ),
              dotyposCustomerId: abandoned,
              dotyposReservationId: abandonedReservation,
              reservationState: "hold_expired",
              paymentState: "expired",
              fulfillmentState: "not_started",
              reservationDetails,
              locale: "en-US",
              createdAt,
            },
            {
              checkoutAttemptKey: checkoutAttemptKeySchema.make(
                `unfulfilled-${run}`
              ),
              dotyposCustomerId: unfulfilled,
              dotyposReservationId: DotyposReservationIdSchema.make(
                `unfulfilled-${run}`
              ),
              reservationState: "confirmed",
              reservationConfirmedAt: confirmedAt,
              paymentState: "paid",
              paidAt: confirmedAt,
              fulfillmentState: "failed",
              fulfillmentFailedAt: confirmedAt,
              fulfillmentFailureCode: "fulfillment_email_failed",
              reservationDetails,
              locale: "en-US",
              createdAt,
            },
            {
              checkoutAttemptKey: checkoutAttemptKeySchema.make(
                `unverified-linked-${run}`
              ),
              dotyposCustomerId: unverifiedLinked,
              dotyposReservationId: DotyposReservationIdSchema.make(
                `unverified-linked-${run}`
              ),
              reservationState: "confirmed",
              reservationConfirmedAt: confirmedAt,
              paymentState: "paid",
              paidAt: confirmedAt,
              fulfillmentState: "not_started",
              reservationDetails,
              locale: "en-US",
              createdAt,
            },
          ]),
          db.insert(authUser).values([
            {
              id: accountId,
              name: "Campaign test",
              email: testEmailAddress(`campaign-${run}`),
              emailVerified: true,
              locale: "en-US",
              createdAt: new Date(accountCreatedAt.epochMilliseconds),
            },
            {
              id: unverifiedAccountId,
              name: "Unverified campaign test",
              email: testEmailAddress(`campaign-unverified-${run}`),
              emailVerified: false,
              locale: "en-US",
              createdAt: new Date(accountCreatedAt.epochMilliseconds),
            },
          ]),
          db.insert(customerMarketingConsents).values([
            {
              dotyposCustomerId: consented,
              documentHash: "hash",
              locale: "en-US",
              grantedAt: createdAt,
            },
            {
              dotyposCustomerId: withdrawn,
              documentHash: "hash",
              locale: "en-US",
              grantedAt: createdAt,
              withdrawnAt: createdAt,
            },
          ]),
        ])
      );
      await Effect.runPromise(
        db.insert(customerAccountLinks).values([
          { customerAccountId: accountId, dotyposCustomerId: linked },
          {
            customerAccountId: unverifiedAccountId,
            dotyposCustomerId: unverifiedLinked,
          },
        ])
      );
      await seedCampaignDeliveries();
    });

    /**
     * Two sends. `linked` was retried in attempt 2, `consented` was settled by
     * a webhook without a batch, and `unfulfilled` bounced.
     */
    const seedCampaignDeliveries = async () => {
      const filter = JSON.stringify({
        _tag: "Group",
        operator: "and",
        filters: [],
      });
      await testDatabase.pool.query(
        `insert into email_campaigns (id, title, purpose, template_key, status)
         values ($1, 'Marketing', 'marketing', 'workspace', 'sent'),
                ($2, 'Operational', 'operational', 'workspace', 'sent')`,
        [marketingCampaign, operationalCampaign]
      );
      await testDatabase.pool.query(
        `insert into email_campaign_sends (id, campaign_id, audience_filter, content_hash, delivery_attempt)
         values ($1, $2, $5, 'hash', 2), ($3, $4, $5, 'hash', 1)`,
        [
          marketingSend,
          marketingCampaign,
          operationalSend,
          operationalCampaign,
          filter,
        ]
      );
      await testDatabase.pool.query(
        `insert into email_campaign_recipients (send_id, dotypos_customer_id, locale, status, delivery_attempt, status_updated_at)
         values ($1, $3, 'cs-CZ', 'delivered', 1, '2026-10-01T11:00:00Z'),
                ($1, $4, 'cs-CZ', 'bounced', 1, '2026-10-01T11:00:00Z'),
                ($1, $5, 'cs-CZ', 'sent', 2, '2026-10-02T11:00:00Z'),
                ($1, $6, 'cs-CZ', 'unconfirmed', 1, '2026-10-03T10:00:00Z'),
                ($2, $3, 'cs-CZ', 'complained', 1, '2026-10-04T11:00:00Z')`,
        [
          marketingSend,
          operationalSend,
          reserved,
          unfulfilled,
          linked,
          consented,
        ]
      );
      await testDatabase.pool.query(
        `insert into email_campaign_delivery_batches (send_id, delivery_attempt, batch_index, dotypos_customer_ids, payload_hash, status, requested_at, settled_at)
         values ($1, 1, 0, $3, 'hash', 'accepted', '2026-10-01T10:00:00Z', '2026-10-01T10:00:01Z'),
                ($1, 1, 1, $4, 'hash', 'rejected', '2026-09-01T10:00:00Z', '2026-09-01T10:00:01Z'),
                ($1, 2, 0, $4, 'hash', 'accepted', '2026-10-02T10:00:00Z', '2026-10-02T10:00:01Z'),
                ($2, 1, 0, $5, 'hash', 'accepted', '2026-10-04T10:00:00Z', '2026-10-04T10:00:01Z')`,
        [
          marketingSend,
          operationalSend,
          [reserved, unfulfilled],
          [linked],
          [reserved],
        ]
      );
    };

    const automatedCampaignIds: CampaignId[] = [];

    afterAll(async () => {
      await deleteAutomatedCampaigns(db, automatedCampaignIds);
      await testDatabase.pool.query(
        "delete from email_campaign_sends where id = any($1)",
        [[marketingSend, operationalSend]]
      );
      await testDatabase.pool.query(
        "delete from email_campaigns where id = any($1)",
        [[marketingCampaign, operationalCampaign]]
      );
      await testDatabase.pool.query(
        "delete from workspace_reservations where dotypos_customer_id = any($1)",
        [seeded]
      );
      await testDatabase.pool.query(
        "delete from customer_marketing_consents where dotypos_customer_id = any($1)",
        [seeded]
      );
      await testDatabase.pool.query(
        'delete from auth."user" where id = any($1)',
        [[accountId, unverifiedAccountId]]
      );
    });

    const repository = <A, E>(
      use: (
        repository: CampaignCandidateRepository["Service"]
      ) => Effect.Effect<A, E>
    ) =>
      Effect.runPromise(
        CampaignCandidateRepository.pipe(Effect.flatMap(use)).pipe(
          Effect.provide(CampaignCandidateRepository.Default),
          Effect.provide(testDatabase.layer)
        )
      );

    const seededCandidates = async (purpose: "marketing" | "operational") =>
      (await repository((candidates) => candidates.listCandidates({ purpose })))
        .filter(({ dotyposCustomerId }) => seeded.includes(dotyposCustomerId))
        .sort((left, right) =>
          left.dotyposCustomerId.localeCompare(right.dotyposCustomerId)
        );

    test("limits marketing candidates to active consents", async () => {
      expect(
        (await seededCandidates("marketing")).map(
          ({ dotyposCustomerId }) => dotyposCustomerId
        )
      ).toEqual([consented]);
    });

    test("lists only the given customers, with the same pool rules", async () => {
      const listed = async (
        purpose: "marketing" | "operational",
        ids: readonly (typeof seeded)[number][]
      ) =>
        (
          await repository((candidates) =>
            candidates.listCandidates({ purpose, ids })
          )
        )
          .map(({ dotyposCustomerId }) => dotyposCustomerId)
          .sort();
      expect(
        await listed("operational", [reserved, linked, withdrawn])
      ).toEqual([reserved, linked, withdrawn].sort());
      expect(await listed("marketing", [consented, withdrawn])).toEqual([
        consented,
      ]);
      expect(await listed("operational", [])).toEqual([]);
      const operational = await seededCandidates("operational");
      expect(
        (
          await repository((candidates) =>
            candidates.listCandidates({ purpose: "operational", ids: [linked] })
          )
        )[0]
      ).toEqual(
        operational.find(
          ({ dotyposCustomerId }) => dotyposCustomerId === linked
        )
      );
    });

    test("collects every known customer with their locale sources", async () => {
      const candidates = await seededCandidates("operational");
      expect(candidates).toEqual(
        expect.arrayContaining([
          {
            dotyposCustomerId: reserved,
            hasAccount: false,
            accountLocale: null,
            latestReservationLocale: "en-US",
            latestReservationAt: createdAt,
            consentLocale: null,
          },
          {
            dotyposCustomerId: linked,
            hasAccount: true,
            accountLocale: "en-US",
            latestReservationLocale: null,
            latestReservationAt: null,
            consentLocale: null,
          },
          {
            dotyposCustomerId: unverifiedLinked,
            hasAccount: false,
            accountLocale: null,
            latestReservationLocale: "en-US",
            latestReservationAt: createdAt,
            consentLocale: null,
          },
          expect.objectContaining({
            dotyposCustomerId: withdrawn,
            consentLocale: "en-US",
          }),
        ])
      );
      expect(candidates).toHaveLength(7);
    });

    const reservationCounts = (selection: CampaignReservationSelection) =>
      repository((candidates) => candidates.countReservations(selection));
    const matches = async (
      selection: CampaignReservationSelection,
      customer = reserved
    ) => ((await reservationCounts(selection)).get(customer) ?? 0) > 0;

    test("counts only booked reservations when no status is chosen", async () => {
      const booked = await reservationCounts({});
      expect(booked.get(reserved)).toBe(1);
      expect(booked.get(unfulfilled)).toBe(1);
      expect(booked.has(abandoned)).toBe(false);
      expect(
        await matches(
          { dotyposReservationIds: [abandonedReservation] },
          abandoned
        )
      ).toBe(false);
      expect(await matches({ status: "cancelled" }, abandoned)).toBe(true);
      expect(
        (await reservationCounts({ status: "cancelled" })).get(reserved)
      ).toBe(1);
    });

    test("treats an abandoned checkout as no reservation", async () => {
      const condition = (operator: "gt" | "eq"): AudienceCondition => ({
        attribute: "reservationCount",
        _tag: "Condition",
        params: { dateBasis: "booking", period: { _tag: "AnyTime" } },
        operator,
        value: 0,
      });
      const facts = {
        counts: new Map([
          [
            audienceFactKey(
              countFactRequest(
                audienceAttributeCatalogue.reservationCount,
                condition("gt") as AudienceCountCondition,
                context
              )
            ),
            await reservationCounts({ booked: {} }),
          ],
        ]),
        dates: new Map(),
      };
      const evaluate = (operator: "gt" | "eq") =>
        evaluateAudienceFilter({
          filter: condition(operator),
          candidate: {
            dotyposCustomerId: abandoned,
            locale: "en-US",
            hasAccount: false,
          },
          context,
          facts,
          profile: Option.none(),
        });
      expect(evaluate("gt")).toBe("noMatch");
      expect(evaluate("eq")).toBe("match");
    });

    test("dates bookings by their confirmation on the Prague calendar day", async () => {
      expect(await matches(bookedOnPragueDay("2026-03-11"))).toBe(true);
      expect(await matches(bookedOnPragueDay("2026-03-10"))).toBe(false);
      expect(
        await matches({
          ...bookedOnPragueDay("2026-03-11"),
          status: "complete",
        })
      ).toBe(true);
      expect(
        await matches({
          ...bookedOnPragueDay("2026-03-11"),
          status: "cancelled",
        })
      ).toBe(false);
      expect(
        await matches(
          { ...bookedOnPragueDay("2026-03-10"), status: "cancelled" },
          abandoned
        )
      ).toBe(false);
      expect(await matches({ booked: { startsBefore: confirmedAt } })).toBe(
        false
      );
      expect(
        await matches({
          booked: { startsBefore: confirmedAt.add({ seconds: 1 }) },
        })
      ).toBe(true);
    });

    test("includes a booking confirmed exactly at an evaluation-time end", async () => {
      expect(await matches({ booked: { startsAtOrBefore: confirmedAt } })).toBe(
        true
      );
      expect(
        await matches({
          booked: {
            startsAtOrBefore: confirmedAt.subtract({ milliseconds: 1 }),
          },
        })
      ).toBe(false);
    });

    test("matches reservations by their Dotypos reservation", async () => {
      expect(
        await matches({ dotyposReservationIds: [visitedReservation] })
      ).toBe(true);
      expect(await matches({ dotyposReservationIds: [] })).toBe(false);
      expect(
        await repository((candidates) =>
          candidates.listBookedReservations([
            visitedReservation,
            abandonedReservation,
          ])
        )
      ).toEqual([
        {
          dotyposReservationId: visitedReservation,
          dotyposCustomerId: reserved,
        },
      ]);
    });

    const receivedEmails = async (query: {
      readonly purpose?: "marketing" | "operational";
      readonly dispatched: DatePeriodBounds;
    }) =>
      Object.fromEntries(
        [
          ...(await repository((candidates) =>
            candidates.countReceivedCampaignEmails(query)
          )),
        ].filter(([id]) => seeded.includes(id))
      );

    test("counts accepted campaign emails per customer and purpose", async () => {
      expect(await receivedEmails({ dispatched: {} })).toEqual({
        [reserved]: 2,
        [linked]: 1,
        [consented]: 1,
      });
      expect(
        await receivedEmails({ purpose: "operational", dispatched: {} })
      ).toEqual({ [reserved]: 1 });
    });

    test("counts an automated send's recipients under its version's purpose", async () => {
      const recipient = customerId("automated-recipient");
      // The campaign's own draft is operational; its published version is
      // marketing, and that is what its sends were mailed as.
      const campaignId = await seedAutomatedCampaign(db, {
        purpose: "operational",
      });
      automatedCampaignIds.push(campaignId);
      const versionId = await seedAutomationVersion(db, {
        campaignId,
        purpose: "marketing",
      });
      for (const status of ["delivered", "unconfirmed", "failed"] as const) {
        await seedAutomatedSend(db, {
          campaignId,
          versionId,
          purpose: "marketing",
          recipients: [{ dotyposCustomerId: recipient, status }],
        });
      }
      const received = async (query: {
        readonly purpose?: "marketing" | "operational";
        readonly campaignId?: CampaignId;
      }) =>
        Object.fromEntries(
          await repository((candidates) =>
            candidates.countReceivedCampaignEmails({
              ...query,
              dispatched: {},
              customers: [recipient],
            })
          )
        );

      expect(await received({ purpose: "marketing" })).toEqual({
        [recipient]: 2,
      });
      expect(await received({ purpose: "operational" })).toEqual({});
      expect(await received({})).toEqual({ [recipient]: 2 });
      expect(await received({ campaignId })).toEqual({ [recipient]: 2 });
    });

    test("dates an email by the current attempt's batch, or by its status without one", async () => {
      const october = Temporal.Instant.from("2026-10-01T12:00:00Z");
      expect(
        await receivedEmails({
          purpose: "marketing",
          dispatched: { startsAtOrAfter: october },
        })
      ).toEqual({ [linked]: 1, [consented]: 1 });
      // linked's attempt-1 batch from September no longer dates it.
      expect(
        await receivedEmails({ dispatched: { startsBefore: october } })
      ).toEqual({ [reserved]: 1 });
    });

    test("reads account creation from the linked Better Auth user", async () => {
      const facts = (created: DatePeriodBounds, asOf = context.now) =>
        repository((candidates) =>
          candidates.accountCreations({ created, asOf })
        );
      const september = Temporal.Instant.from("2026-09-01T00:00:00Z");
      expect(
        (await facts({ startsAtOrAfter: september })).inPeriod.has(linked)
      ).toBe(true);
      const before = await facts({ startsBefore: september });
      expect(before.withValue.has(linked)).toBe(true);
      expect(before.inPeriod.has(linked)).toBe(false);
      expect(before.withValue.has(reserved)).toBe(false);
      expect(before.withValue.has(unverifiedLinked)).toBe(false);
      expect(before.inPeriod.has(unverifiedLinked)).toBe(false);
      // An account created after the moment doesn't exist yet then.
      const earlier = await facts({}, accountCreatedAt.subtract({ hours: 2 }));
      expect(earlier.withValue.has(linked)).toBe(false);
      expect(earlier.inPeriod.has(linked)).toBe(false);
      expect((await facts({}, accountCreatedAt)).withValue.has(linked)).toBe(
        true
      );
    });

    test("finds when the earliest reservation was created", async () => {
      const earliest = await repository(
        (candidates) => candidates.earliestReservationAt
      );
      expect(
        earliest !== null &&
          Temporal.Instant.compare(
            earliest,
            createdAt.subtract({ hours: 240 })
          ) <= 0
      ).toBe(true);
    });

    describe("schedule fire pool", () => {
      /** Linked through `customer_accounts` alone, with a verified login. */
      const columnLinked = customerId("column-linked");
      /** Linked through an unverified backfilled login, with no reservation. */
      const unverifiedOnly = customerId("unverified-only");
      const columnAccountId = `campaign-column-account-${run}`;
      const unverifiedOnlyAccountId = `campaign-unverified-only-account-${run}`;
      const pooled = [...seeded, columnLinked, unverifiedOnly];

      beforeAll(async () => {
        await Effect.runPromise(
          db.insert(authUser).values([
            {
              id: columnAccountId,
              name: "Column-linked campaign test",
              email: testEmailAddress(`campaign-column-${run}`),
              emailVerified: true,
              locale: "en-US",
            },
            {
              id: unverifiedOnlyAccountId,
              name: "Unverified-only campaign test",
              email: testEmailAddress(`campaign-unverified-only-${run}`),
              emailVerified: false,
              locale: "en-US",
            },
          ])
        );
        await Effect.runPromise(
          Effect.all([
            db.insert(customerAccounts).values({
              id: customerAccountIdSchema.make(columnAccountId),
              dotyposCustomerId: columnLinked,
            }),
            db.insert(customerAccountLinks).values({
              customerAccountId: unverifiedOnlyAccountId,
              dotyposCustomerId: unverifiedOnly,
            }),
          ])
        );
      });

      afterAll(async () => {
        await testDatabase.pool.query(
          "delete from customer_accounts where id = $1",
          [columnAccountId]
        );
        await testDatabase.pool.query(
          'delete from auth."user" where id = any($1)',
          [[columnAccountId, unverifiedOnlyAccountId]]
        );
      });

      test("pools the customers listCandidates lists", async () => {
        for (const purpose of ["marketing", "operational"] as const) {
          const pool = (
            await Effect.runPromise(listCampaignCandidateIds(db, purpose))
          ).filter((id) => pooled.includes(id));
          const candidates = (
            await repository((candidates) =>
              candidates.listCandidates({ purpose })
            )
          )
            .map(({ dotyposCustomerId }) => dotyposCustomerId)
            .filter((id) => pooled.includes(id))
            .sort();
          expect(pool).toEqual(candidates);
          expect(pool.includes(unverifiedOnly)).toBe(false);
        }
        const operational = await Effect.runPromise(
          listCampaignCandidateIds(db, "operational")
        );
        expect(operational.includes(columnLinked)).toBe(true);
      });
    });
  }
);
