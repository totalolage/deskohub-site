import "@/shared/testing/workspace-test-env";

import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  DotyposCustomerIdSchema,
  DotyposCustomerSchema,
  DotyposRejected,
  type DotyposReservationId,
  DotyposService,
  DotyposTableIdSchema,
  DotyposTableSchema,
  DotyposUnavailable,
  DotyposUncertain,
} from "@deskohub/dotypos";
import { makeInMemoryDotypos } from "@deskohub/dotypos/testing";
import { EmailDeliveryIdSchema } from "@deskohub/email";
import { testEmailAddress } from "@deskohub/test-email";
import { eq } from "drizzle-orm";
import { Deferred, Effect, Fiber, Layer, Result, Schema } from "effect";
import { TestClock } from "effect/testing";
import { WorkspaceDatabase } from "@/db/database.service";
import { WorkspaceDatabaseAdvisoryLock } from "@/db/postgres-advisory-lock";
import {
  customerAccounts,
  orders,
  passPurchases,
  paymentAttempts,
  unlimitedPassSupersessions,
  workspaceReservations,
} from "@/db/schema";
import { authUser } from "@/db/schema/auth";
import {
  holdCustomerAccountAndPassPurchase,
  WorkspaceLockSections,
} from "@/db/workspace-locks";
import { CurrentCustomerAccount } from "@/features/account/backend/current-customer-account";
import { CustomerAccountContactService } from "@/features/account/backend/customer-account-contact.service";
import {
  CustomerAccountSections,
  HeldCustomerAccount,
} from "@/features/account/backend/customer-account-sections";
import { testSessionProfile } from "@/features/account/backend/customer-authentication.test-utils";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import { WorkspaceTableAssignmentService } from "@/features/checkout/backend/reservation/workspace-table-assignment.service";
import { paymentAttemptIdSchema } from "@/features/checkout/checkout-identifiers";
import { DiscountService } from "@/features/discounts/discount.service";
import { WorkspaceFeatureFlagService } from "@/features/feature-flags/backend/workspace-feature-flag.service";
import { orderIdSchema } from "@/features/order";
import { GoogleCalendarWorkspaceLimitationsService } from "@/features/reservation/backend/google-calendar-workspace-limitations.service";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import {
  deliveryReportEmailId,
  deliveryReportEventId,
} from "@/shared/backend/email/delivery-reports";
import { currencyCZK } from "@/shared/money/currencies";
import { fixtureReservationAuthorId } from "@/shared/testing/workspace-fixtures.test-utils";
import { waitForPostgresLockWaiter } from "@/shared/testing/workspace-postgres-lock-waiters.test-utils";
import {
  createWorkspacePostgresSuiteDatabase,
  type WorkspacePostgresSuiteDatabase,
} from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { plainDateStringSchema } from "@/shared/utils/temporal";
import {
  ambiguousPassDayHoldCode,
  formatPassDayMarker,
  rejectedPassDayHoldCode,
} from "../pass-day-marker";
import { unlimitedPassDays } from "../pass-offer";
import { passPurchaseQuoteCodec } from "../pass-purchase-quote";
import { unlimitedCheckoutPredecessorLimit } from "../unlimited-pass-checkout";
import {
  getPassPurchasePriceFingerprint,
  repriceEntryPackPurchase,
} from "./entry-pack-purchase";
import { settlePassPurchase } from "./entry-pack-settlement";
import { reconcileUnlimitedPassReleases } from "./pass-purchase-reconciliation";
import { unlimitedConfirmationDeliveryReports } from "./unlimited-confirmation-delivery";
import { getBookableUnlimitedStarts } from "./unlimited-pass-capacity";
import {
  confirmUnlimitedPassDays,
  createUnlimitedPassHolds,
  readUnlimitedPassDays,
  reconfirmUnlimitedPassHolds,
  releaseUnlimitedPassDays,
} from "./unlimited-pass-holds";
import {
  readUnlimitedPassRenewal,
  recordReplacementUnlimitedPassHolds,
  recordUnlimitedPassOrder,
} from "./unlimited-pass-orders";
import {
  beginUnlimitedPassPurchase as beginUnlimitedPassPurchaseWithDisposition,
  loadUnlimitedCheckoutContinuation,
} from "./unlimited-pass-purchase";
import { prepareUnlimitedPassRecovery } from "./unlimited-pass-recovery";

let database: WorkspacePostgresSuiteDatabase | null;
beforeEach(async () => {
  database = await createWorkspacePostgresSuiteDatabase("unlimited_holds");
});
afterEach(async () => {
  await database?.close();
});

const it = test.skipIf(!process.env.WORKSPACE_TEST_DATABASE_URL);
const customerId = DotyposCustomerIdSchema.make("123");
const tableId = DotyposTableIdSchema.make("42");
const date = (value: Temporal.PlainDate) =>
  plainDateStringSchema.make(value.toString());
const newAccountId = () => customerAccountIdSchema.make(crypto.randomUUID());

const beginUnlimitedPassPurchase = (
  ...input: Parameters<typeof beginUnlimitedPassPurchaseWithDisposition>
) =>
  beginUnlimitedPassPurchaseWithDisposition(...input).pipe(
    Effect.flatMap(({ outcome }) => Effect.fromResult(outcome))
  );

const record = (
  start: Temporal.PlainDate,
  buyer = newAccountId(),
  holder = fixtureReservationAuthorId,
  {
    tier = "reserved-desk",
    createdAt = Temporal.Now.instant(),
    renewsPassId,
    assignedTableId = tableId,
  }: {
    tier?: "open-space" | "reserved-desk";
    createdAt?: Temporal.Instant;
    renewsPassId?: typeof passPurchases.$inferSelect.id;
    assignedTableId?: typeof tableId;
  } = {}
) =>
  Effect.gen(function* () {
    const { db, transaction } = yield* WorkspaceDatabase;
    yield* db
      .insert(customerAccounts)
      .values({ id: buyer })
      .onConflictDoNothing();
    return yield* transaction(
      recordUnlimitedPassOrder({
        orderId: orderIdSchema.make(crypto.randomUUID()),
        locale: "en-US",
        buyer: { accountId: buyer, customerId },
        holder: { accountId: holder, customerId },
        createdAt,
        ...(renewsPassId && { renewsPassId }),
        selection:
          tier === "open-space"
            ? { startDate: date(start), tier, coffee: false }
            : { startDate: date(start), tier },
        quote: {
          product: { kind: "unlimited", tier },
          discountableSubtotal: currencyCZK(599_000),
          discountedSubtotal: currencyCZK(599_000),
          totalDiscount: currencyCZK(0),
          discounts: [],
        },
        days: Array.from({ length: unlimitedPassDays }, (_, index) => ({
          serviceDate: date(start.add({ days: index })),
          tableId: assignedTableId,
        })),
      })
    );
  });

const recordRenewableGift = Effect.fnUntraced(function* (claimed = true) {
  const buyer = newAccountId();
  const holder = newAccountId();
  const now = Temporal.Now.instant();
  const start = getCurrentWorkspaceDate(now).add({ days: 2 });
  const { db } = yield* WorkspaceDatabase;
  yield* db.insert(customerAccounts).values({ id: holder });
  const source = yield* record(start, buyer, holder, { createdAt: now });
  yield* db.insert(authUser).values(
    [buyer, holder].map((id) => ({
      id,
      email: testEmailAddress(`unlimited-renewal-${id}`),
      name: "Synthetic renewal account",
      emailVerified: true,
    }))
  );
  yield* db
    .update(passPurchases)
    .set({
      status: "active",
      giftIssuedAt: now,
      giftClaimedAt: claimed ? now : null,
    })
    .where(eq(passPurchases.id, source.id));
  return { source, buyer, holder, now };
});

const expirePass = Effect.fnUntraced(function* (
  orderId: typeof orders.$inferSelect.id
) {
  const { db } = yield* WorkspaceDatabase;
  const attemptId = paymentAttemptIdSchema.make(crypto.randomUUID());
  yield* db.insert(paymentAttempts).values({
    id: attemptId,
    orderId,
    provider: "mock",
    providerOrderId: attemptId,
    state: "expired",
    failureCode: "fixture_expired",
    amountValue: 599_000,
    amountExponent: 2,
    currency: "CZK",
  });
  yield* db
    .update(orders)
    .set({ paymentState: "expired", activePaymentAttemptId: attemptId })
    .where(eq(orders.id, orderId));
  yield* settlePassPurchase(orderId);
  return attemptId;
});

it("serializes overlapping entitlement purchases for the same holder", async () => {
  const start = getCurrentWorkspaceDate().add({ days: 60 });
  const results = await Effect.runPromise(
    Effect.all(
      [
        Effect.result(record(start)),
        Effect.result(record(start.add({ days: 1 }))),
      ],
      { concurrency: 2 }
    ).pipe(Effect.provide(database!.layer))
  );
  expect(results.filter(Result.isSuccess)).toHaveLength(1);
  expect(
    results.filter(Result.isFailure).map((result) => result.failure)
  ).toEqual([expect.objectContaining({ reason: "overlapping-pass" })]);
});

it("serializes an overlapping regular gift and renewal bought by different accounts for the same holder", async () => {
  const testDatabase = database!;
  await Effect.runPromise(
    Effect.gen(function* () {
      const { source, buyer, holder, now } = yield* recordRenewableGift();
      const start = Temporal.PlainDate.from(source.validUntil);
      const { transaction } = yield* WorkspaceDatabase;
      const renewalRecorded = yield* Deferred.make<void>();
      const regular = yield* Deferred.await(renewalRecorded).pipe(
        Effect.andThen(record(start.add({ days: 1 }), buyer, holder)),
        Effect.result,
        Effect.forkChild
      );

      const renewal = yield* transaction(
        record(start, holder, holder, {
          createdAt: now,
          renewsPassId: source.id,
        }).pipe(
          Effect.tap(() => Deferred.succeed(renewalRecorded, undefined)),
          Effect.tap(() =>
            Effect.promise(() =>
              waitForPostgresLockWaiter(testDatabase.pool, {
                condition:
                  "locktype = 'transactionid' and database is null and pid in (select pid from pg_stat_activity where datname = current_database())",
                description:
                  "the regular purchase waiting for the renewal holder lock",
              })
            )
          )
        )
      );

      expect(renewal).toMatchObject({
        buyerAccountId: holder,
        holderAccountId: holder,
        renewsPassId: source.id,
      });
      expect(yield* Fiber.join(regular)).toMatchObject({
        _tag: "Failure",
        failure: {
          _tag: "UnlimitedPassAdmissionError",
          reason: "overlapping-pass",
        },
      });
    }).pipe(Effect.provide(testDatabase.layer))
  );
});

it("offers a gifted Unlimited renewal only to its current holder after claim", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const { source, buyer, holder, now } = yield* recordRenewableGift(false);
      expect(
        yield* readUnlimitedPassRenewal(source.id, holder, now)
      ).toBeUndefined();
      const { db } = yield* WorkspaceDatabase;
      yield* db
        .update(passPurchases)
        .set({ giftClaimedAt: now })
        .where(eq(passPurchases.id, source.id));

      expect(
        yield* readUnlimitedPassRenewal(source.id, buyer, now)
      ).toBeUndefined();
      expect(yield* readUnlimitedPassRenewal(source.id, holder, now)).toEqual({
        tier: "reserved-desk",
        startDate: source.validUntil,
      });
    }).pipe(Effect.provide(database!.layer))
  );
});

it("rejects late renewal recovery after a regular order takes the holder's window", async () => {
  const testDatabase = database!;
  const competingTableId = DotyposTableIdSchema.make("43");
  const tables = [tableId, competingTableId].map((id) =>
    Schema.decodeUnknownSync(DotyposTableSchema)({
      id,
      _cloudId: "1",
      display: true,
      enabled: true,
      name: `Synthetic reserved desk ${id}`,
      seats: "1",
      tags: ["cowork:reserved-desk"],
    })
  );
  const provider = makeInMemoryDotypos({ tables });
  const services = Layer.mergeAll(
    testDatabase.layer,
    provider.layer,
    WorkspaceDatabaseAdvisoryLock.makeLayer(testDatabase.databasePool),
    WorkspaceReservationRepository.Default.pipe(
      Layer.provide(testDatabase.layer)
    ),
    Layer.mock(GoogleCalendarWorkspaceLimitationsService, {
      listLimitations: () => Effect.succeed([]),
    })
  );

  await Effect.runPromise(
    Effect.gen(function* () {
      const { source, buyer, holder, now } = yield* recordRenewableGift();
      const start = Temporal.PlainDate.from(source.validUntil);
      const renewal = yield* record(start, holder, holder, {
        createdAt: now,
        renewsPassId: source.id,
      });
      yield* createUnlimitedPassHolds(renewal);
      const attemptId = yield* expirePass(renewal.id);
      yield* record(start, buyer, holder, {
        assignedTableId: competingTableId,
      });

      expect(
        yield* prepareUnlimitedPassRecovery(renewal.id, attemptId).pipe(
          WorkspaceLockSections.unlimitedPassRecovery(renewal.id)
        )
      ).toBe(false);
      expect(
        [...provider.reservations.values()].map(({ status }) => status)
      ).toEqual(Array(unlimitedPassDays).fill("CANCELLED"));
    }).pipe(Effect.provide(services))
  );
});

it("records the earliest verified buyer delivery for the winning attempt only", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const purchase = yield* record(
        getCurrentWorkspaceDate().add({ days: 100 })
      );
      const { db } = yield* WorkspaceDatabase;
      const attemptId = paymentAttemptIdSchema.make(crypto.randomUUID());
      const paidAt = Temporal.Instant.from("2026-11-20T10:00:00Z");
      yield* db.insert(paymentAttempts).values({
        id: attemptId,
        orderId: purchase.id,
        provider: "internal",
        state: "paid",
        amountValue: 0,
        amountExponent: 2,
        currency: "CZK",
      });
      yield* db
        .update(orders)
        .set({
          paymentState: "paid",
          paidAt,
          activePaymentAttemptId: attemptId,
        })
        .where(eq(orders.id, purchase.id));

      const report = (
        minutes: number,
        paymentId: string,
        deployment = "preview"
      ) =>
        unlimitedConfirmationDeliveryReports.receive({
          eventId: deliveryReportEventId(`fixture-delivery-${minutes}`),
          event: "email.delivered",
          emailId: deliveryReportEmailId(
            EmailDeliveryIdSchema.make("fixture-email")
          ),
          occurredAt: paidAt.add({ minutes }),
          tags: new Map([
            ["orderId", purchase.id],
            ["paymentAttemptId", paymentId],
            ["deploymentEnvironment", deployment],
          ]),
          deploymentEnvironment: "preview",
        });
      expect((yield* report(1, "obsolete-attempt")).status).toBe("ignored");
      expect((yield* report(2, attemptId, "production")).status).toBe(
        "ignored"
      );
      expect((yield* report(8, attemptId)).status).toBe("processed");
      expect((yield* report(4, attemptId)).status).toBe("processed");
      expect((yield* report(10, attemptId)).status).toBe("processed");
      const [recorded] = yield* db
        .select({ deliveredAt: passPurchases.buyerConfirmationDeliveredAt })
        .from(passPurchases)
        .where(eq(passPurchases.id, purchase.id));
      expect(recorded?.deliveredAt?.equals(paidAt.add({ minutes: 4 }))).toBe(
        true
      );
    }).pipe(Effect.provide(database!.layer))
  );
});

it("reacquires all provider holds on the original rows after terminal payment", async () => {
  const testDatabase = (await createWorkspacePostgresSuiteDatabase(
    "unlimited_recovery"
  ))!;
  const table = Schema.decodeUnknownSync(DotyposTableSchema)({
    id: tableId,
    _cloudId: "1",
    display: true,
    enabled: true,
    name: "Synthetic reserved desk",
    seats: "1",
    tags: ["cowork:reserved-desk"],
  });
  const provider = makeInMemoryDotypos({ tables: [table] });
  const services = Layer.mergeAll(
    testDatabase.layer,
    provider.layer,
    WorkspaceDatabaseAdvisoryLock.makeLayer(testDatabase.databasePool),
    WorkspaceReservationRepository.Default.pipe(
      Layer.provide(testDatabase.layer)
    ),
    Layer.mock(GoogleCalendarWorkspaceLimitationsService, {
      listLimitations: () => Effect.succeed([]),
    })
  );

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const purchase = yield* record(
          getCurrentWorkspaceDate().add({ days: 140 })
        );
        yield* createUnlimitedPassHolds(purchase);
        const initial = yield* readUnlimitedPassDays(purchase.id);
        const attemptId = yield* expirePass(purchase.id);

        const restored = yield* prepareUnlimitedPassRecovery(
          purchase.id,
          attemptId
        ).pipe(WorkspaceLockSections.unlimitedPassRecovery(purchase.id));
        expect(restored).toBe(true);
        const replaced = yield* readUnlimitedPassDays(purchase.id);
        expect(replaced.map(({ id }) => id)).toEqual(
          initial.map(({ id }) => id)
        );
        expect(
          replaced.every(
            (row, index) =>
              row.dotyposReservationId !== initial[index]?.dotyposReservationId
          )
        ).toBe(true);
        const providerRecords = [...provider.reservations.values()];
        expect(
          providerRecords.filter((record) => record.status === "NEW")
        ).toHaveLength(unlimitedPassDays);
        expect(
          providerRecords.filter((record) => record.status === "CANCELLED")
        ).toHaveLength(unlimitedPassDays);
      }).pipe(Effect.provide(services))
    );
  } finally {
    await testDatabase.close();
  }
});

it("releases a definitively rejected POST and retains an interrupted POST", async () => {
  const provider = makeInMemoryDotypos({});
  const start = getCurrentWorkspaceDate().add({ days: 200 });
  const rejected = new DotyposRejected({
    operation: "createReservation",
    reason: "invalid-request",
  });
  const layer = database!.layer;

  await Effect.runPromise(
    Effect.gen(function* () {
      const purchase = yield* record(start);
      const [first, second] = yield* readUnlimitedPassDays(purchase.id);
      const createReservation: typeof provider.service.createReservation = (
        input
      ) =>
        input.note?.includes(`/${first!.serviceDate}/`)
          ? Effect.fail(rejected)
          : provider.service.createReservation(input);
      const failed = yield* Effect.result(
        createUnlimitedPassHolds(purchase)
      ).pipe(
        Effect.provideService(DotyposService, {
          ...provider.service,
          createReservation,
        })
      );
      expect(failed).toEqual(Result.fail(rejected));
      const [released, held] = yield* readUnlimitedPassDays(purchase.id);
      expect(released).toMatchObject({
        id: first!.id,
        failureCode: rejectedPassDayHoldCode,
        reservationState: "hold_expired",
        dotyposReservationId: null,
        passDayHoldGeneration: expect.any(String),
      });
      expect(held).toMatchObject({ id: second!.id, reservationState: "held" });
      yield* releaseUnlimitedPassDays(purchase);
      expect(
        (yield* readUnlimitedPassDays(purchase.id))[0]?.reservationState
      ).toBe("hold_expired");

      const interrupted = yield* record(start.add({ days: 40 }));
      const attempted = yield* Effect.exit(
        createUnlimitedPassHolds(interrupted)
      ).pipe(
        Effect.provideService(DotyposService, {
          ...provider.service,
          createReservation: () => Effect.interrupt,
        })
      );
      expect(attempted._tag).toBe("Failure");
      const requested = (yield* readUnlimitedPassDays(interrupted.id)).filter(
        (row) => row.passDayHoldRequestedAt !== null
      );
      expect(requested.length).toBeGreaterThan(0);
      yield* releaseUnlimitedPassDays(interrupted);
      const remaining = (yield* readUnlimitedPassDays(interrupted.id)).filter(
        (row) => row.reservationState === "creating_hold"
      );
      expect(
        remaining.map(({ id, passDayHoldGeneration }) => ({
          id,
          passDayHoldGeneration,
        }))
      ).toEqual(
        requested.map(({ id, passDayHoldGeneration }) => ({
          id,
          passDayHoldGeneration,
        }))
      );
    }).pipe(Effect.provide(Layer.mergeAll(layer, provider.layer)))
  );
});

it("keeps a timed-out replacement claimed while only the cancelled original is visible", async () => {
  const provider = makeInMemoryDotypos({});
  const start = getCurrentWorkspaceDate().add({ days: 290 });
  let hidden: DotyposReservationId | undefined;

  await Effect.runPromise(
    Effect.gen(function* () {
      const purchase = yield* record(start);
      yield* createUnlimitedPassHolds(purchase);
      const original = yield* readUnlimitedPassDays(purchase.id);
      const first = original[0]!;

      // One day represents a hold created by the previous deployment.
      const { db, transaction } = yield* WorkspaceDatabase;
      yield* db
        .update(workspaceReservations)
        .set({ passDayHoldGeneration: null })
        .where(eq(workspaceReservations.id, first.id));
      const originalRecord = provider.reservations.get(
        first.dotyposReservationId!
      )!;
      provider.reservations.set(originalRecord.id, {
        ...originalRecord,
        note: formatPassDayMarker(purchase.id, start, null),
      });
      yield* reconfirmUnlimitedPassHolds(purchase);

      const paidAttemptId = yield* expirePass(purchase.id);
      const retired = { ...purchase, status: "void" } as const;
      yield* releaseUnlimitedPassDays(retired);
      const replacement = yield* transaction(
        recordReplacementUnlimitedPassHolds({
          purchase: retired,
          paidAttemptId,
          days: original.map(({ serviceDate, passDayTableId }) => ({
            serviceDate,
            tableId: passDayTableId,
          })),
          now: Temporal.Now.instant(),
        })
      );
      const replacementService = {
        ...provider.service,
        createReservation: (
          input: Parameters<typeof provider.service.createReservation>[0]
        ) =>
          Effect.gen(function* () {
            if (!input.note?.includes(`/${first.serviceDate}/`)) {
              return yield* provider.service.createReservation(input);
            }
            const [journaled] = yield* db
              .select()
              .from(workspaceReservations)
              .where(eq(workspaceReservations.id, first.id))
              .pipe(Effect.orDie);
            expect(journaled?.passDayHoldRequestedAt).toBeDefined();
            expect(journaled?.passDayHoldRequestedAt).not.toBeNull();
            expect(input.note).toContain(journaled!.passDayHoldGeneration!);
            const created = yield* provider.service.createReservation(input);
            hidden = created.id;
            return yield* new DotyposUncertain({
              operation: "createReservation",
              reason: "timeout",
            });
          }),
        listReservations: (
          ...args: Parameters<typeof provider.service.listReservations>
        ) =>
          provider.service
            .listReservations(...args)
            .pipe(
              Effect.map((records) => records.filter(({ id }) => id !== hidden))
            ),
      };
      const outcome = yield* Effect.result(
        createUnlimitedPassHolds(replacement)
      ).pipe(Effect.provideService(DotyposService, replacementService));
      expect(outcome).toEqual(
        Result.fail(expect.objectContaining({ _tag: "DotyposUncertain" }))
      );
      const [pending] = yield* readUnlimitedPassDays(purchase.id);
      const replacementId = hidden!;
      expect(provider.reservations.get(replacementId)?.note).toContain(
        pending!.passDayHoldGeneration!
      );
      expect(provider.reservations.get(originalRecord.id)?.status).toBe(
        "CANCELLED"
      );
      yield* releaseUnlimitedPassDays(replacement).pipe(
        Effect.provideService(DotyposService, replacementService)
      );
      const [stillPending] = yield* readUnlimitedPassDays(purchase.id);
      expect(stillPending).toMatchObject({
        id: first.id,
        reservationState: "creating_hold",
        dotyposReservationId: null,
        passDayHoldGeneration: pending!.passDayHoldGeneration,
      });

      hidden = undefined;
      yield* releaseUnlimitedPassDays(replacement).pipe(
        Effect.provideService(DotyposService, {
          ...replacementService,
          cancelReservation: (id) =>
            provider.service.cancelReservation(id).pipe(
              Effect.andThen(
                Effect.fail(
                  new DotyposUncertain({
                    operation: "cancelReservation",
                    reason: "timeout",
                  })
                )
              )
            ),
        })
      );
      expect((yield* readUnlimitedPassDays(purchase.id))[0]).toMatchObject({
        id: first.id,
        reservationState: "cancelling",
        dotyposReservationId: replacementId,
      });
      hidden = replacementId;
      yield* releaseUnlimitedPassDays(replacement).pipe(
        Effect.provideService(DotyposService, replacementService)
      );
      const [released] = yield* readUnlimitedPassDays(purchase.id);
      expect(released).toMatchObject({
        id: first.id,
        reservationState: "cancelled",
        dotyposReservationId: replacementId,
      });
      expect(provider.reservations.get(replacementId)?.status).toBe(
        "CANCELLED"
      );
    }).pipe(Effect.provide(Layer.mergeAll(database!.layer, provider.layer)))
  );
});

for (const firstObservation of [
  "release",
  "expired create",
  "live capacity",
  "missing assignment table",
  "parallel lookup failure",
  "repeated provider ID",
] as const) {
  it(`settles ownership evidence from ${firstObservation}`, async () => {
    const provider = makeInMemoryDotypos({});
    const start = getCurrentWorkspaceDate().add({ days: 340 });
    let original: DotyposReservationId | undefined;
    let copy: DotyposReservationId | undefined;
    let omitOriginal = false;
    const service: DotyposService["Service"] = {
      ...provider.service,
      createReservation: (input) =>
        Effect.gen(function* () {
          const created = yield* provider.service.createReservation(input);
          if (!input.note?.includes(`/${start}/`)) return created;
          original = created.id;
          if (firstObservation !== "repeated provider ID") {
            copy = (yield* provider.service.createReservation(input)).id;
          }
          return yield* new DotyposUncertain({
            operation: "createReservation",
            reason: "timeout",
          });
        }),
      listReservations: (input) =>
        provider.service.listReservations(input).pipe(
          Effect.map((records) => {
            if (omitOriginal)
              return records.filter(({ id }) => id !== original);
            const first = records.find(({ id }) => id === original);
            return firstObservation === "repeated provider ID" && first
              ? [...records, first]
              : records;
          })
        ),
    };

    await Effect.runPromise(
      Effect.gen(function* () {
        const purchase = yield* record(start);
        const timedOut = yield* Effect.result(
          createUnlimitedPassHolds(purchase)
        );
        expect(timedOut).toEqual(
          Result.fail(expect.objectContaining({ _tag: "DotyposUncertain" }))
        );
        if (firstObservation === "repeated provider ID") {
          yield* releaseUnlimitedPassDays(purchase);
          expect((yield* readUnlimitedPassDays(purchase.id))[0]).toMatchObject({
            reservationState: "cancelled",
            dotyposReservationId: original,
            failureCode: null,
          });
          return;
        }
        if (firstObservation === "parallel lookup failure") {
          const repository = yield* WorkspaceReservationRepository;
          const recording = yield* Deferred.make<void>();
          const tableFailed = yield* Deferred.make<void>();
          const finishRecording = yield* Deferred.make<void>();
          const tableError = new DotyposUnavailable({
            operation: "getTables",
            reason: "server",
          });
          const assignment = Effect.flatMap(
            WorkspaceTableAssignmentService,
            (service) =>
              service.getAssignedTableAvailability({
                reservation: provider.reservations.get(original!)!,
                kind: "cowork",
              })
          ).pipe(
            Effect.provide(WorkspaceTableAssignmentService.Default),
            Effect.provideService(DotyposService, {
              ...service,
              getTables: () =>
                Deferred.await(recording).pipe(
                  Effect.andThen(Effect.fail(tableError)),
                  Effect.ensuring(
                    Deferred.succeed(tableFailed, undefined).pipe(Effect.asVoid)
                  )
                ),
            }),
            Effect.provideService(WorkspaceReservationRepository, {
              ...repository,
              recordAmbiguousPassDayHolds: (claims) =>
                Deferred.succeed(recording, undefined).pipe(
                  Effect.andThen(Deferred.await(finishRecording)),
                  Effect.andThen(repository.recordAmbiguousPassDayHolds(claims))
                ),
            })
          );
          const fiber = yield* Effect.forkChild(Effect.result(assignment));
          yield* Deferred.await(tableFailed);
          yield* Effect.yieldNow;
          yield* Deferred.succeed(finishRecording, undefined);
          expect(yield* Fiber.join(fiber)).toEqual(Result.fail(tableError));
        } else if (firstObservation === "missing assignment table") {
          const unavailable = yield* Effect.flatMap(
            WorkspaceTableAssignmentService,
            (assignment) =>
              assignment.getAssignedTableAvailability({
                reservation: provider.reservations.get(original!)!,
                kind: "cowork",
              })
          ).pipe(Effect.provide(WorkspaceTableAssignmentService.Default));
          expect(unavailable).toBe("unavailable");
        } else if (firstObservation === "live capacity") {
          yield* getBookableUnlimitedStarts({
            startsOn: start,
            endsBefore: start.add({ days: 1 }),
            selection: { tier: "reserved-desk" },
          });
        } else if (firstObservation === "expired create") {
          const { db } = yield* WorkspaceDatabase;
          yield* db
            .update(workspaceReservations)
            .set({
              reservationHoldExpiresAt: Temporal.Now.instant().subtract({
                minutes: 1,
              }),
            })
            .where(eq(workspaceReservations.passId, purchase.id));
          const expired = yield* Effect.result(
            createUnlimitedPassHolds(purchase)
          );
          expect(expired).toEqual(
            Result.fail(expect.objectContaining({ reason: "expired" }))
          );
        } else {
          yield* releaseUnlimitedPassDays(purchase);
        }
        const [ambiguous] = yield* readUnlimitedPassDays(purchase.id);
        expect(ambiguous).toMatchObject({
          reservationState: "creating_hold",
          dotyposReservationId: null,
          failureCode: ambiguousPassDayHoldCode,
        });
        const genuine = original!;
        const copied = copy!;
        omitOriginal = true;
        yield* releaseUnlimitedPassDays(purchase);
        const retry = yield* Effect.result(createUnlimitedPassHolds(purchase));
        expect(retry).toEqual(
          Result.fail(expect.objectContaining({ reason: "unfinished" }))
        );
        expect((yield* readUnlimitedPassDays(purchase.id))[0]).toEqual(
          ambiguous
        );
        expect(provider.reservations.get(genuine)?.status).toBe("NEW");
        expect(provider.reservations.get(copied)?.status).toBe("NEW");
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            database!.layer,
            WorkspaceReservationRepository.Default.pipe(
              Layer.provide(database!.layer)
            ),
            Layer.mock(GoogleCalendarWorkspaceLimitationsService, {
              listLimitations: () => Effect.succeed([]),
            })
          )
        ),
        Effect.provideService(DotyposService, service)
      )
    );
  });
}

function unlimitedDraftLayer(
  accountId: ReturnType<typeof newAccountId>,
  dotypos: typeof DotyposService.Service
) {
  const email = testEmailAddress("unlimited-draft");
  const session = {
    ...testSessionProfile,
    accountId,
    email,
    deletionRequested: false,
  };
  return Layer.mergeAll(
    database!.layer,
    Layer.mock(CurrentCustomerAccount, {
      requireActive: Effect.succeed(session),
    }),
    Layer.mock(CustomerAccountSections, {
      withActiveAccount: (_accountId, operation) =>
        Effect.provideService(operation, HeldCustomerAccount, {
          accountId,
          email,
        }),
    }),
    Layer.mock(CustomerAccountContactService, {}),
    Layer.mock(DiscountService, {}),
    Layer.mock(WorkspaceFeatureFlagService, {
      isEnabled: () => Effect.succeed(true),
    }),
    WorkspaceDatabaseAdvisoryLock.makeLayer(database!.databasePool),
    Layer.mock(WorkspaceReservationRepository, {}),
    Layer.mock(GoogleCalendarWorkspaceLimitationsService, {}),
    Layer.succeed(DotyposService, dotypos)
  );
}

it("preserves an uncertain Continue and replays both rejected dates after void", async () => {
  const start = getCurrentWorkspaceDate().add({ days: 100 });
  const rejectedDates = [
    date(start.add({ days: 2 })),
    date(start.add({ days: 3 })),
  ];
  const accountId = newAccountId();
  const provider = makeInMemoryDotypos({});
  const layer = unlimitedDraftLayer(accountId, {
    ...provider.service,
    createReservation: (input) => {
      if (input.note?.includes(`/${date(start)}/`)) {
        return provider.service.createReservation(input).pipe(
          Effect.andThen(
            Effect.fail(
              new DotyposUncertain({
                operation: "createReservation",
                reason: "timeout",
              })
            )
          )
        );
      }
      if (rejectedDates.some((day) => input.note?.includes(`/${day}/`))) {
        return Effect.fail(
          new DotyposRejected({
            operation: "createReservation",
            reason: "invalid-request",
          })
        );
      }
      return provider.service.createReservation(input);
    },
  });

  await Effect.runPromise(
    Effect.gen(function* () {
      const purchase = yield* record(start, accountId, accountId);
      const begin = beginUnlimitedPassPurchase({
        orderId: purchase.id,
        locale: "en-US",
        selection: { tier: "reserved-desk", startDate: date(start) },
      });
      expect(yield* Effect.result(begin)).toEqual(
        Result.fail(expect.objectContaining({ _tag: "DotyposUncertain" }))
      );
      const { db } = yield* WorkspaceDatabase;
      const status = db
        .select({ status: passPurchases.status })
        .from(passPurchases)
        .where(eq(passPurchases.id, purchase.id));
      expect(yield* status).toEqual([{ status: "pending_payment" }]);

      const expected = Result.fail(
        expect.objectContaining({
          _tag: "UnlimitedPassDraftVoided",
          blockingDates: rejectedDates,
        })
      );
      expect(yield* Effect.result(begin)).toEqual(expected);
      expect(yield* status).toEqual([{ status: "void" }]);
      expect(yield* Effect.result(begin)).toEqual(expected);
    }).pipe(Effect.provide(layer))
  );
});

it("Continue releases each owned predecessor and leaves other buyers' drafts in place", async () => {
  const start = getCurrentWorkspaceDate().add({ days: 100 });
  const accountId = newAccountId();
  const provider = makeInMemoryDotypos({});
  const layer = unlimitedDraftLayer(accountId, provider.service);

  await Effect.runPromise(
    Effect.gen(function* () {
      const first = yield* record(start, accountId, accountId);
      const second = yield* record(
        start.add({ days: 31 }),
        accountId,
        accountId
      );
      const foreign = yield* record(
        start,
        newAccountId(),
        fixtureReservationAuthorId
      );
      const replacement = yield* record(
        start.add({ days: 62 }),
        accountId,
        accountId
      );
      yield* createUnlimitedPassHolds(first);
      yield* createUnlimitedPassHolds(second);

      const result = yield* beginUnlimitedPassPurchase({
        orderId: replacement.id,
        locale: "en-US",
        selection: { tier: "reserved-desk", startDate: replacement.validFrom },
        supersedeOrderId: first.id,
        supersedeOrderIds: [foreign.id, second.id, first.id, replacement.id],
      });
      expect(result.id).toBe(replacement.id);
      const { db } = yield* WorkspaceDatabase;
      for (const prior of [first, second]) {
        const [purchase] = yield* db
          .select({ status: passPurchases.status })
          .from(passPurchases)
          .where(eq(passPurchases.id, prior.id));
        expect(purchase?.status).toBe("void");
        const rows = yield* readUnlimitedPassDays(prior.id);
        expect(rows.every((day) => day.reservationState === "cancelled")).toBe(
          true
        );
      }
      const [foreignPurchase] = yield* db
        .select({ status: passPurchases.status })
        .from(passPurchases)
        .where(eq(passPurchases.id, foreign.id));
      expect(foreignPurchase?.status).toBe("pending_payment");
      expect(
        [...provider.reservations.values()].filter(
          (row) => row.status === "NEW"
        )
      ).toHaveLength(unlimitedPassDays);
    }).pipe(Effect.provide(layer))
  );
});

it("Continue acknowledges retired predecessors when a stale date prevents a draft", async () => {
  const today = getCurrentWorkspaceDate();
  const accountId = newAccountId();
  const provider = makeInMemoryDotypos({});
  const layer = unlimitedDraftLayer(accountId, provider.service);

  await Effect.runPromise(
    Effect.gen(function* () {
      const protectedDraft = yield* record(today, accountId, accountId);
      yield* expirePass(protectedDraft.id);
      const retired = Array.from(
        { length: unlimitedCheckoutPredecessorLimit - 1 },
        () => orderIdSchema.make(crypto.randomUUID())
      );
      const orderId = orderIdSchema.make(crypto.randomUUID());
      const result = yield* beginUnlimitedPassPurchaseWithDisposition({
        orderId,
        locale: "en-US",
        selection: {
          tier: "reserved-desk",
          startDate: date(today.subtract({ days: 1 })),
        },
        supersedeOrderIds: [protectedDraft.id, ...retired],
      });
      expect(result).toEqual({
        outcome: Result.fail(
          expect.objectContaining({ reason: "holds-unavailable" })
        ),
        retiredPredecessorOrderIds: retired,
      });
      const { db } = yield* WorkspaceDatabase;
      const markers = yield* db.select().from(unlimitedPassSupersessions);
      expect(markers).toHaveLength(retired.length);
      expect(markers).toEqual(
        expect.arrayContaining(
          retired.map((orderId) => ({ buyerAccountId: accountId, orderId }))
        )
      );
      expect(yield* db.select({ id: orders.id }).from(orders)).toEqual([
        { id: protectedDraft.id },
      ]);
    }).pipe(Effect.provide(layer))
  );
});

function makeUnlimitedDraftProvider() {
  return makeInMemoryDotypos({
    tables: [
      Schema.decodeUnknownSync(DotyposTableSchema)({
        id: tableId,
        _cloudId: "1",
        display: true,
        enabled: true,
        name: "Synthetic reserved desk",
        seats: "1",
        tags: ["cowork:reserved-desk"],
      }),
    ],
  });
}

function unlimitedNewDraftLayer(
  accountId: ReturnType<typeof newAccountId>,
  email: string,
  dotypos: typeof DotyposService.Service
) {
  const session = {
    ...testSessionProfile,
    accountId,
    email,
    deletionRequested: false,
  };
  const testDatabase = database!;
  return Layer.mergeAll(
    testDatabase.layer,
    Layer.succeed(DotyposService, dotypos),
    WorkspaceDatabaseAdvisoryLock.makeLayer(testDatabase.databasePool),
    WorkspaceReservationRepository.Default.pipe(
      Layer.provide(testDatabase.layer)
    ),
    Layer.mock(GoogleCalendarWorkspaceLimitationsService, {
      listLimitations: () => Effect.succeed([]),
    }),
    Layer.mock(CurrentCustomerAccount, {
      requireActive: Effect.succeed(session),
      peek: Effect.succeed({
        kind: "linked",
        session,
        account: { accountId, dotyposCustomerId: customerId },
        autoLinked: false,
      }),
    }),
    Layer.mock(CustomerAccountSections, {
      withActiveAccount: (buyer, operation, options) => {
        const hold = options?.passPurchaseOrderId
          ? holdCustomerAccountAndPassPurchase(
              buyer,
              options.passPurchaseOrderId
            )
          : WorkspaceLockSections.customerAccount(buyer);
        return hold(
          Effect.provideService(operation, HeldCustomerAccount, {
            accountId: buyer,
            email,
          })
        );
      },
    }),
    Layer.mock(CustomerAccountContactService, {}),
    Layer.mock(WorkspaceFeatureFlagService, {
      isEnabled: () => Effect.succeed(true),
    }),
    Layer.mock(DiscountService, {
      quote: ({ product, discountableSubtotal }) =>
        Effect.succeed({
          product,
          discountableSubtotal,
          discountedSubtotal: discountableSubtotal,
          totalDiscount: currencyCZK(0),
          discounts: [],
        }),
    })
  );
}

it("starts a renewal at the source's exclusive end and rejects a replay with a changed source", async () => {
  const provider = makeUnlimitedDraftProvider();
  const { source, holder } = await Effect.runPromise(
    recordRenewableGift().pipe(Effect.provide(database!.layer))
  );
  const layer = unlimitedNewDraftLayer(
    holder,
    testEmailAddress(`unlimited-renewal-${holder}`),
    provider.service
  );

  await Effect.runPromise(
    Effect.gen(function* () {
      const input = {
        orderId: orderIdSchema.make(crypto.randomUUID()),
        locale: "en-US" as const,
        selection: {
          tier: "reserved-desk" as const,
          startDate: source.validUntil,
        },
      };
      const lateStart = Temporal.PlainDate.from(source.validUntil).add({
        days: 1,
      });
      const offByOne = yield* Effect.flip(
        beginUnlimitedPassPurchase({
          ...input,
          selection: { ...input.selection, startDate: date(lateStart) },
          renewsPassId: source.id,
        })
      );
      expect(offByOne).toMatchObject({
        _tag: "UnlimitedPassAdmissionError",
        reason: "renewal-unavailable",
      });

      const renewal = { ...input, renewsPassId: source.id };
      expect(yield* beginUnlimitedPassPurchase(renewal)).toMatchObject({
        id: input.orderId,
        validFrom: source.validUntil,
        renewsPassId: source.id,
      });
      expect(yield* beginUnlimitedPassPurchase(renewal)).toMatchObject({
        id: input.orderId,
        renewsPassId: source.id,
      });

      for (const replay of [
        input,
        { ...input, renewsPassId: orderIdSchema.make(crypto.randomUUID()) },
      ]) {
        expect(
          yield* Effect.flip(beginUnlimitedPassPurchase(replay))
        ).toMatchObject({
          _tag: "UnlimitedPassAdmissionError",
          reason: "draft-changed",
        });
      }
      expect(provider.reservations.size).toBe(unlimitedPassDays);
    }).pipe(Effect.provide(layer))
  );
});

it.each(["linked", "matched", "new", "uncertain create"] as const)(
  "uses a supplied gift name only to create a missing Dotypos profile (%s)",
  async (standing) => {
    const accountId = newAccountId();
    const holderEmail = testEmailAddress("unlimited-named-holder");
    const recipientName = "Ája O’Connell-Svobodová";
    const holderCustomerId = DotyposCustomerIdSchema.make("456");
    const profile = Schema.decodeUnknownSync(DotyposCustomerSchema)({
      id: holderCustomerId,
      _cloudId: "1",
      email: holderEmail,
      firstName: "Existing holder",
      points: "0",
      flags: "0",
      display: true,
      deleted: false,
    });
    const provider = makeUnlimitedDraftProvider();
    let present = standing === "matched";
    let lookups = 0;
    const creates: unknown[] = [];
    const layer = unlimitedNewDraftLayer(
      accountId,
      testEmailAddress("unlimited-name-buyer"),
      {
        ...provider.service,
        findCustomer: (input, options) =>
          Effect.sync(() => {
            lookups += 1;
            expect(input).toEqual({ firstName: "", email: holderEmail });
            expect(options?.lookupFields).toEqual(["email"]);
            return present
              ? { _tag: "Matched", customer: profile, matches: [profile] }
              : { _tag: "NotFound", matches: [] };
          }),
        createCustomer: (input) =>
          Effect.gen(function* () {
            expect(provider.reservations.size).toBe(0);
            creates.push(input);
            present = true;
            if (standing === "uncertain create")
              return yield* new DotyposUncertain({
                operation: "createCustomer",
                reason: "timeout",
              });
            return profile;
          }),
      }
    );
    await Effect.runPromise(
      Effect.gen(function* () {
        const { db } = yield* WorkspaceDatabase;
        yield* db.insert(customerAccounts).values({ id: accountId });
        if (standing === "linked") {
          const holderId = newAccountId();
          yield* db.insert(customerAccounts).values({
            id: holderId,
            dotyposCustomerId: holderCustomerId,
          });
          yield* db.insert(authUser).values({
            id: holderId,
            email: holderEmail,
            name: "Existing holder login",
          });
        }
        const input = {
          orderId: orderIdSchema.make(crypto.randomUUID()),
          locale: "en-US" as const,
          selection: {
            tier: "reserved-desk" as const,
            startDate: date(getCurrentWorkspaceDate().add({ days: 2 })),
          },
          holderEmail,
          recipientName,
        };
        const begin = beginUnlimitedPassPurchase(input);
        if (standing === "uncertain create") {
          expect(yield* Effect.result(begin)).toEqual(
            Result.fail(expect.objectContaining({ _tag: "DotyposUncertain" }))
          );
          expect(provider.reservations.size).toBe(0);
        }
        const purchase = yield* begin;
        expect(purchase.id).toBe(input.orderId);
        expect(purchase.holderAccountId).not.toBe(accountId);
        expect(
          yield* beginUnlimitedPassPurchase({
            ...input,
            recipientName: "Changed on retry",
          })
        ).toEqual(purchase);
        const days = yield* readUnlimitedPassDays(purchase.id);
        expect(days).toHaveLength(unlimitedPassDays);
        expect(
          days.every((day) => day.dotyposCustomerId === holderCustomerId)
        ).toBe(true);
        expect(provider.reservations.size).toBe(unlimitedPassDays);
        expect(lookups).toBe(
          { linked: 0, matched: 1, new: 1, "uncertain create": 2 }[standing]
        );
        const [holder] = yield* db
          .select()
          .from(customerAccounts)
          .where(eq(customerAccounts.id, purchase.holderAccountId));
        expect(holder?.dotyposCustomerId).toBe(
          standing === "linked" ? holderCustomerId : null
        );
        const [login] = yield* db
          .select({ name: authUser.name })
          .from(authUser)
          .where(eq(authUser.id, purchase.holderAccountId));
        expect(login?.name).toBe(
          standing === "linked" ? "Existing holder login" : ""
        );
        expect(JSON.stringify({ purchase, holder, days })).not.toContain(
          recipientName
        );
        expect(creates).toEqual(
          standing === "linked" || standing === "matched"
            ? []
            : [
                expect.objectContaining({
                  email: holderEmail,
                  firstName: "Ája",
                  lastName: "O’Connell-Svobodová",
                }),
              ]
        );
      }).pipe(Effect.provide(layer))
    );
  }
);

async function checkDelayedContinue(
  retirement: "replacement" | "capacity refusal"
) {
  const start = getCurrentWorkspaceDate().add({ days: 2 });
  const accountId = newAccountId();
  const provider = makeUnlimitedDraftProvider();
  const layer = unlimitedNewDraftLayer(
    accountId,
    testEmailAddress("unlimited-late-continue"),
    provider.service
  );
  await Effect.runPromise(
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;
      yield* db.insert(customerAccounts).values({ id: accountId });
      const originalId = orderIdSchema.make(crypto.randomUUID());
      const replacementId = orderIdSchema.make(crypto.randomUUID());
      const entered = yield* Deferred.make<void>();
      const proceed = yield* Deferred.make<void>();
      const delayed = yield* beginUnlimitedPassPurchase({
        orderId: originalId,
        locale: "en-US",
        selection: { tier: "reserved-desk", startDate: date(start) },
      }).pipe(
        Effect.provide(
          Layer.mock(WorkspaceFeatureFlagService, {
            isEnabled: () =>
              Deferred.succeed(entered, undefined).pipe(
                Effect.andThen(Deferred.await(proceed)),
                Effect.as(true)
              ),
          })
        ),
        Effect.forkChild
      );
      yield* Deferred.await(entered);
      if (retirement === "capacity refusal") {
        const refused = yield* Effect.result(
          beginUnlimitedPassPurchase({
            orderId: originalId,
            locale: "en-US",
            selection: {
              tier: "reserved-desk-workstation",
              monitorOption: "2x27-qhd",
              startDate: date(start),
            },
          })
        );
        expect(refused).toEqual(
          Result.fail(
            expect.objectContaining({
              _tag: "UnlimitedPassCapacityUnavailable",
            })
          )
        );
        yield* Deferred.succeed(proceed, undefined);
        expect(yield* Effect.result(Fiber.join(delayed))).toEqual(
          Result.fail(
            expect.objectContaining({ _tag: "UnlimitedPassDraftVoided" })
          )
        );
        expect(yield* db.select().from(unlimitedPassSupersessions)).toEqual([
          { buyerAccountId: accountId, orderId: originalId },
        ]);
        expect(yield* db.select({ id: orders.id }).from(orders)).toEqual([]);
        expect(provider.reservations.size).toBe(0);
        return;
      }
      const selection = {
        tier: "reserved-desk" as const,
        startDate: date(start.add({ days: 31 })),
      };
      const replacement = yield* beginUnlimitedPassPurchase({
        orderId: replacementId,
        locale: "en-US",
        selection,
        supersedeOrderIds: [originalId],
      });
      expect(replacement.id).toBe(replacementId);
      yield* Deferred.succeed(proceed, undefined);
      expect(yield* Effect.result(Fiber.join(delayed))).toEqual(
        Result.fail(
          expect.objectContaining({
            _tag: "UnlimitedPassDraftVoided",
            blockingDates: [],
          })
        )
      );
      expect(yield* db.select().from(unlimitedPassSupersessions)).toEqual([
        { buyerAccountId: accountId, orderId: originalId },
      ]);
      expect(yield* db.select({ id: orders.id }).from(orders)).toEqual([
        { id: replacementId },
      ]);
      expect(provider.reservations.size).toBe(unlimitedPassDays);

      expect(
        yield* Effect.result(
          beginUnlimitedPassPurchase({
            orderId: replacementId,
            locale: "en-US",
            selection,
            holderEmail: testEmailAddress("unlimited-different-holder"),
          })
        )
      ).toEqual(
        Result.fail(
          expect.objectContaining({
            _tag: "UnlimitedPassAdmissionError",
            reason: "draft-changed",
          })
        )
      );
    }).pipe(Effect.provide(layer))
  );
}

it("a late Continue cannot create a non-overlapping draft after replacement", () =>
  checkDelayedContinue("replacement"));

it("a late Continue cannot create a draft after capacity refusal", () =>
  checkDelayedContinue("capacity refusal"));

it("rejects a Continue replay when an attached day's deadline passed", async () => {
  const provider = makeInMemoryDotypos({});
  await Effect.runPromise(
    Effect.gen(function* () {
      const start = getCurrentWorkspaceDate().add({ days: 4000 });
      const purchase = yield* record(start);
      yield* createUnlimitedPassHolds(purchase);
      const [first] = yield* readUnlimitedPassDays(purchase.id);
      const { db } = yield* WorkspaceDatabase;
      yield* db
        .update(workspaceReservations)
        .set({
          reservationHoldExpiresAt: Temporal.Now.instant().subtract({
            seconds: 1,
          }),
        })
        .where(eq(workspaceReservations.id, first!.id));
      const replay = yield* Effect.result(createUnlimitedPassHolds(purchase));
      expect(replay).toEqual(
        Result.fail(
          expect.objectContaining({
            reason: "expired",
            blockingDates: [first!.serviceDate],
          })
        )
      );
      expect(provider.reservations.size).toBe(unlimitedPassDays);
    }).pipe(
      Effect.provide(database!.layer),
      Effect.provideService(DotyposService, provider.service)
    )
  );
});

it("replays expired service dates after losing the Continue response", async () => {
  const provider = makeInMemoryDotypos({});
  const accountId = newAccountId();
  await Effect.runPromise(
    Effect.gen(function* () {
      const start = getCurrentWorkspaceDate().add({ days: 100 });
      const purchase = yield* record(start, accountId, accountId);
      yield* createUnlimitedPassHolds(purchase);
      const days = yield* readUnlimitedPassDays(purchase.id);
      const expired = [days[0]!, days[2]!];
      const { db } = yield* WorkspaceDatabase;
      for (const day of expired) {
        yield* db
          .update(workspaceReservations)
          .set({
            reservationHoldExpiresAt: Temporal.Now.instant().subtract({
              seconds: 1,
            }),
          })
          .where(eq(workspaceReservations.id, day.id));
      }
      const begin = beginUnlimitedPassPurchase({
        orderId: purchase.id,
        locale: "en-US",
        selection: { tier: "reserved-desk", startDate: date(start) },
      });
      const expected = Result.fail(
        expect.objectContaining({
          _tag: "UnlimitedPassDraftVoided",
          blockingDates: expired.map((day) => day.serviceDate),
        })
      );
      expect(yield* Effect.result(begin)).toEqual(expected);
      // Retry the same request after the definitive response was lost.
      expect(yield* Effect.result(begin)).toEqual(expected);
      const [voided] = yield* db
        .select({ quote: passPurchases.quote, status: passPurchases.status })
        .from(passPurchases)
        .where(eq(passPurchases.id, purchase.id));
      const decodeQuote = Schema.decodeSync(passPurchaseQuoteCodec);
      const acceptedQuote = decodeQuote(purchase.quote);
      expect(voided?.status).toBe("void");
      expect(decodeQuote(voided!.quote)).toEqual(acceptedQuote);
      const staleReprice = repriceEntryPackPurchase({
        orderId: purchase.id,
        productKind: "unlimited",
        displayedPriceFingerprint:
          getPassPurchasePriceFingerprint(acceptedQuote),
      }).pipe(
        Effect.provide(
          Layer.mock(DiscountService, {
            quote: () => Effect.succeed(acceptedQuote),
          })
        )
      );
      expect(yield* Effect.result(staleReprice)).toEqual(
        Result.fail(
          expect.objectContaining({
            _tag: "EntryPackPurchaseError",
            reason: "quote-expired",
          })
        )
      );
      expect(yield* Effect.result(begin)).toEqual(expected);
      expect(provider.reservations.size).toBe(unlimitedPassDays);
      const released = yield* readUnlimitedPassDays(purchase.id);
      expect(
        released.every((day) => day.reservationState === "cancelled")
      ).toBe(true);
    }).pipe(Effect.provide(unlimitedDraftLayer(accountId, provider.service)))
  );
});

it.each([
  { tier: "open-space", closesAt: "2030-01-15T16:00:00Z" },
  { tier: "reserved-desk", closesAt: "2030-01-15T23:00:00Z" },
] as const)(
  "Continue voids live $tier holds at the first Prague cutoff",
  async ({ tier, closesAt }) => {
    const start = Temporal.PlainDate.from("2030-01-15");
    const cutoff = Temporal.Instant.from(closesAt);
    const beforeCutoff = cutoff.subtract({ minutes: 2 });
    const accountId = newAccountId();
    const provider = makeInMemoryDotypos({});
    const layer = Layer.merge(
      unlimitedDraftLayer(accountId, provider.service),
      TestClock.layer()
    );

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* TestClock.setTime(beforeCutoff.epochMilliseconds);
        const purchase = yield* record(start, accountId, accountId, {
          tier,
          createdAt: beforeCutoff,
        });
        yield* createUnlimitedPassHolds(purchase);
        const selection =
          tier === "open-space"
            ? { tier, coffee: false, startDate: date(start) }
            : { tier, startDate: date(start) };
        const input = {
          orderId: purchase.id,
          locale: "en-US",
          selection,
        } as const;
        expect((yield* beginUnlimitedPassPurchase(input)).id).toBe(purchase.id);
        const days = yield* readUnlimitedPassDays(purchase.id);
        expect(days).toHaveLength(unlimitedPassDays);
        expect(
          days.every(
            (day) =>
              day.reservationState === "held" &&
              day.reservationHoldExpiresAt &&
              Temporal.Instant.compare(day.reservationHoldExpiresAt, cutoff) > 0
          )
        ).toBe(true);
        expect(Temporal.Instant.compare(purchase.holdsExpireAt!, cutoff)).toBe(
          1
        );
        const { db } = yield* WorkspaceDatabase;
        expect(yield* db.select().from(paymentAttempts)).toEqual([]);

        yield* TestClock.setTime(cutoff.epochMilliseconds);
        const predecessorOrderIds = Array.from(
          { length: unlimitedCheckoutPredecessorLimit },
          () => orderIdSchema.make(crypto.randomUUID())
        );
        const outcome = Result.fail(
          expect.objectContaining({
            _tag: "UnlimitedPassDraftVoided",
            blockingDates: [date(start)],
          })
        );
        expect(
          yield* beginUnlimitedPassPurchaseWithDisposition({
            ...input,
            supersedeOrderIds: predecessorOrderIds,
          })
        ).toEqual({ outcome, retiredPredecessorOrderIds: predecessorOrderIds });
        expect(yield* Effect.result(beginUnlimitedPassPurchase(input))).toEqual(
          outcome
        );
        const [voided] = yield* db
          .select()
          .from(passPurchases)
          .where(eq(passPurchases.id, purchase.id));
        expect(voided).toMatchObject({
          status: "void",
          quote: { voidBlockingDates: [date(start)] },
        });
        const released = yield* readUnlimitedPassDays(purchase.id);
        expect(
          released.every((day) => day.reservationState === "cancelled")
        ).toBe(true);
        expect(
          [...provider.reservations.values()].map(({ status }) => status)
        ).toEqual(Array(unlimitedPassDays).fill("CANCELLED"));
        expect(yield* db.select().from(paymentAttempts)).toEqual([]);
      }).pipe(Effect.provide(layer))
    );
  }
);

it.each(["before", "during"] as const)(
  "Continue voids a draft when the first service day closes %s hold creation",
  async (timing) => {
    const start = Temporal.PlainDate.from("2030-01-15");
    const cutoff = Temporal.Instant.from("2030-01-15T16:00:00Z");
    const beforeCutoff = cutoff.subtract({ minutes: 2 });
    const accountId = newAccountId();
    const provider = makeInMemoryDotypos({});
    const layer = Layer.merge(
      unlimitedDraftLayer(accountId, {
        ...provider.service,
        createReservation: (input) =>
          provider.service
            .createReservation(input)
            .pipe(
              Effect.tap(() =>
                provider.reservations.size === unlimitedPassDays
                  ? TestClock.setTime(cutoff.epochMilliseconds)
                  : Effect.void
              )
            ),
      }),
      TestClock.layer()
    );
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* TestClock.setTime(
          (timing === "before" ? cutoff : beforeCutoff).epochMilliseconds
        );
        const purchase = yield* record(start, accountId, accountId, {
          tier: "open-space",
          createdAt: beforeCutoff,
        });
        expect(
          yield* Effect.result(
            beginUnlimitedPassPurchase({
              orderId: purchase.id,
              locale: "en-US",
              selection: {
                tier: "open-space",
                coffee: false,
                startDate: date(start),
              },
            })
          )
        ).toEqual(
          Result.fail(
            expect.objectContaining({
              _tag: "UnlimitedPassDraftVoided",
              blockingDates: [date(start)],
            })
          )
        );
        expect(provider.reservations.size).toBe(
          timing === "before" ? 0 : unlimitedPassDays
        );
        const released = yield* readUnlimitedPassDays(purchase.id);
        const releasedState =
          timing === "before" ? "hold_expired" : "cancelled";
        expect(
          released.every((day) => day.reservationState === releasedState)
        ).toBe(true);
      }).pipe(Effect.provide(layer))
    );
  }
);

it("replays expiry and change dates without replacing an ambiguous generation", async () => {
  const start = getCurrentWorkspaceDate().add({ days: 100 });
  const accountId = newAccountId();
  const provider = makeInMemoryDotypos({});
  const layer = unlimitedDraftLayer(accountId, {
    ...provider.service,
    createReservation: (input) => {
      if (input.note?.includes(`/${date(start)}/`)) {
        return provider.service.createReservation(input).pipe(
          Effect.andThen(provider.service.createReservation(input)),
          Effect.andThen(
            Effect.fail(
              new DotyposUncertain({
                operation: "createReservation",
                reason: "timeout",
              })
            )
          )
        );
      }
      return provider.service.createReservation(input);
    },
  });
  await Effect.runPromise(
    Effect.gen(function* () {
      const purchase = yield* record(start, accountId, accountId);
      expect(yield* Effect.result(createUnlimitedPassHolds(purchase))).toEqual(
        Result.fail(expect.objectContaining({ _tag: "DotyposUncertain" }))
      );
      const [expired, changed] = yield* readUnlimitedPassDays(purchase.id);
      const { db } = yield* WorkspaceDatabase;
      yield* db
        .update(workspaceReservations)
        .set({
          reservationHoldExpiresAt: Temporal.Now.instant().subtract({
            seconds: 1,
          }),
        })
        .where(eq(workspaceReservations.id, expired!.id));
      yield* provider.service.cancelReservation(changed!.dotyposReservationId!);
      yield* db
        .update(workspaceReservations)
        .set({ reservationState: "cancelled" })
        .where(eq(workspaceReservations.id, changed!.id));
      const begin = beginUnlimitedPassPurchase({
        orderId: purchase.id,
        locale: "en-US",
        selection: { tier: "reserved-desk", startDate: date(start) },
      });
      const expected = Result.fail(
        expect.objectContaining({
          _tag: "UnlimitedPassDraftVoided",
          blockingDates: [expired!.serviceDate, changed!.serviceDate],
        })
      );
      expect(yield* Effect.result(begin)).toEqual(expected);
      expect(yield* Effect.result(begin)).toEqual(expected);
      const [ambiguous] = yield* readUnlimitedPassDays(purchase.id);
      expect(ambiguous).toMatchObject({
        reservationState: "creating_hold",
        failureCode: ambiguousPassDayHoldCode,
        dotyposReservationId: null,
        passDayHoldGeneration: expired!.passDayHoldGeneration,
        passDayHoldRequestedAt: expired!.passDayHoldRequestedAt,
      });
      expect(
        [...provider.reservations.values()].map((day) => day.status).sort()
      ).toEqual(["CANCELLED", "NEW", "NEW"]);
    }).pipe(Effect.provide(layer))
  );
});

it("records every elapsed service date after the shared draft deadline", async () => {
  const start = getCurrentWorkspaceDate().add({ days: 100 });
  const accountId = newAccountId();
  const provider = makeInMemoryDotypos({});
  await Effect.runPromise(
    Effect.gen(function* () {
      const purchase = yield* record(start, accountId, accountId);
      yield* createUnlimitedPassHolds(purchase);
      const { db, transaction } = yield* WorkspaceDatabase;
      const deadline = Temporal.Now.instant().subtract({ seconds: 1 });
      yield* transaction(
        Effect.gen(function* () {
          yield* db
            .update(passPurchases)
            .set({ holdsExpireAt: deadline })
            .where(eq(passPurchases.id, purchase.id));
          yield* db
            .update(workspaceReservations)
            .set({ reservationHoldExpiresAt: deadline })
            .where(eq(workspaceReservations.passId, purchase.id));
        })
      );
      const days = yield* readUnlimitedPassDays(purchase.id);
      const blockingDates = days.map((day) => day.serviceDate);
      expect(blockingDates).toHaveLength(unlimitedPassDays);
      const begin = beginUnlimitedPassPurchase({
        orderId: purchase.id,
        locale: "en-US",
        selection: { tier: "reserved-desk", startDate: date(start) },
      });
      const expected = Result.fail(
        expect.objectContaining({
          _tag: "UnlimitedPassDraftVoided",
          blockingDates,
        })
      );
      expect(yield* Effect.result(begin)).toEqual(expected);
      const [voided] = yield* db
        .select({ status: passPurchases.status, quote: passPurchases.quote })
        .from(passPurchases)
        .where(eq(passPurchases.id, purchase.id));
      expect(voided).toMatchObject({
        status: "void",
        quote: { voidBlockingDates: blockingDates },
      });
      expect(yield* Effect.result(begin)).toEqual(expected);
    }).pipe(Effect.provide(unlimitedDraftLayer(accountId, provider.service)))
  );
});

it("keeps the first uncertain hold retryable when its sibling has expired", async () => {
  const start = getCurrentWorkspaceDate().add({ days: 100 });
  const accountId = newAccountId();
  const provider = makeInMemoryDotypos({});
  const uncertain = new DotyposUncertain({
    operation: "createReservation",
    reason: "timeout",
  });
  const layer = unlimitedDraftLayer(accountId, {
    ...provider.service,
    createReservation: (input) =>
      provider.service
        .createReservation(input)
        .pipe(Effect.andThen(Effect.fail(uncertain))),
  });
  await Effect.runPromise(
    Effect.gen(function* () {
      const purchase = yield* record(start, accountId, accountId);
      const [first, expired, rejected] = yield* readUnlimitedPassDays(
        purchase.id
      );
      const { db } = yield* WorkspaceDatabase;
      const deadline = Temporal.Now.instant().subtract({ seconds: 1 });
      yield* db
        .update(workspaceReservations)
        .set({ reservationHoldExpiresAt: deadline })
        .where(eq(workspaceReservations.id, expired!.id));
      const begin = beginUnlimitedPassPurchase({
        orderId: purchase.id,
        locale: "en-US",
        selection: { tier: "reserved-desk", startDate: date(start) },
      });
      expect(yield* Effect.result(begin)).toEqual(
        Result.fail(expect.objectContaining({ _tag: "DotyposUncertain" }))
      );
      const status = db
        .select({ status: passPurchases.status })
        .from(passPurchases)
        .where(eq(passPurchases.id, purchase.id));
      expect(yield* status).toEqual([{ status: "pending_payment" }]);

      // Capacity can record ambiguity independently of Continue.
      yield* db
        .update(workspaceReservations)
        .set({
          failureCode: ambiguousPassDayHoldCode,
          reservationHoldExpiresAt: deadline,
        })
        .where(eq(workspaceReservations.id, first!.id));
      expect(yield* Effect.result(begin)).toEqual(
        Result.fail(expect.objectContaining({ reason: "unfinished" }))
      );
      expect(yield* status).toEqual([{ status: "pending_payment" }]);

      yield* db
        .update(workspaceReservations)
        .set({
          failureCode: rejectedPassDayHoldCode,
          reservationState: "hold_expired",
        })
        .where(eq(workspaceReservations.id, rejected!.id));
      const expected = Result.fail(
        expect.objectContaining({
          _tag: "UnlimitedPassDraftVoided",
          blockingDates: [
            first!.serviceDate,
            expired!.serviceDate,
            rejected!.serviceDate,
          ],
        })
      );
      expect(yield* Effect.result(begin)).toEqual(expected);
      expect(yield* Effect.result(begin)).toEqual(expected);
      const [ambiguous] = yield* readUnlimitedPassDays(purchase.id);
      expect(ambiguous).toMatchObject({
        failureCode: ambiguousPassDayHoldCode,
        reservationState: "creating_hold",
        dotyposReservationId: null,
      });
      expect(
        [...provider.reservations.values()].map((day) => day.status)
      ).toEqual(["NEW"]);
    }).pipe(Effect.provide(layer))
  );
});

it("replays reconciled void drafts expired before payment and fences expired attempts", async () => {
  const start = getCurrentWorkspaceDate().add({ days: 100 });
  const accountId = newAccountId();
  const provider = makeInMemoryDotypos({});
  const layer = unlimitedDraftLayer(accountId, {
    ...provider.service,
    createReservation: () =>
      Effect.fail(
        new DotyposRejected({
          operation: "createReservation",
          reason: "invalid-request",
        })
      ),
  });
  await Effect.runPromise(
    Effect.gen(function* () {
      const purchase = yield* record(start, accountId, accountId);
      const rejected = yield* Effect.result(createUnlimitedPassHolds(purchase));
      expect(rejected).toEqual(
        Result.fail(expect.objectContaining({ _tag: "DotyposRejected" }))
      );
      yield* reconcileUnlimitedPassReleases({
        limit: 1,
        now: purchase.holdsExpireAt!,
      });
      const { db } = yield* WorkspaceDatabase;
      const [reconciled] = yield* db
        .select({
          paymentState: orders.paymentState,
          activePaymentAttemptId: orders.activePaymentAttemptId,
          status: passPurchases.status,
        })
        .from(orders)
        .innerJoin(passPurchases, eq(passPurchases.id, orders.id))
        .where(eq(orders.id, purchase.id));
      expect(reconciled).toEqual({
        paymentState: "expired",
        activePaymentAttemptId: null,
        status: "void",
      });
      expect(
        yield* loadUnlimitedCheckoutContinuation(purchase.id, "submitted")
      ).toMatchObject({ kind: "details" });
      const begin = beginUnlimitedPassPurchase({
        orderId: purchase.id,
        locale: "en-US",
        selection: { tier: "reserved-desk", startDate: date(start) },
      });
      expect(yield* Effect.result(begin)).toEqual(
        Result.fail(
          expect.objectContaining({
            _tag: "UnlimitedPassDraftVoided",
            blockingDates: [date(start), date(start.add({ days: 1 }))],
          })
        )
      );
      const editedBegin = beginUnlimitedPassPurchase({
        orderId: purchase.id,
        locale: "en-US",
        holderEmail: testEmailAddress("unlimited-edited-void-holder"),
        selection: {
          tier: "reserved-desk",
          startDate: date(start.add({ days: 1 })),
        },
      });
      expect(yield* Effect.result(editedBegin)).toEqual(
        Result.fail(
          expect.objectContaining({
            _tag: "UnlimitedPassDraftVoided",
            blockingDates: [date(start), date(start.add({ days: 1 }))],
          })
        )
      );
      const empty = { ...purchase.quote, voidBlockingDates: [] };
      yield* db
        .update(passPurchases)
        .set({ quote: empty })
        .where(eq(passPurchases.id, purchase.id));
      expect(yield* Effect.result(begin)).toEqual(
        Result.fail(
          expect.objectContaining({
            _tag: "UnlimitedPassDraftVoided",
            blockingDates: [],
          })
        )
      );
      const malformed = { ...purchase.quote, voidBlockingDates: "invalid" };
      yield* db
        .update(passPurchases)
        .set({ quote: malformed })
        .where(eq(passPurchases.id, purchase.id));
      expect(yield* Effect.result(begin)).toEqual(
        Result.fail(expect.objectContaining({ _tag: "SchemaError" }))
      );
      yield* expirePass(purchase.id);
      expect(
        yield* loadUnlimitedCheckoutContinuation(purchase.id, "submitted")
      ).toEqual({ kind: "status", locale: purchase.locale });
      expect(yield* Effect.result(begin)).toEqual(
        Result.fail(
          expect.objectContaining({
            _tag: "EntryPackPurchaseError",
            reason: "payment-in-progress",
          })
        )
      );
      expect(yield* Effect.result(editedBegin)).toEqual(
        Result.fail(
          expect.objectContaining({
            _tag: "UnlimitedPassAdmissionError",
            reason: "purchase-conflict",
          })
        )
      );
    }).pipe(Effect.provide(layer))
  );
});

it("adopts an ambiguous POST, reconfirms all days, then retains today on release", async () => {
  const provider = makeInMemoryDotypos({});
  let interruptOnce = true;
  const createReservation: typeof provider.service.createReservation = (
    input
  ) =>
    provider.service.createReservation(input).pipe(
      Effect.flatMap((created) => {
        if (!interruptOnce) return Effect.succeed(created);
        interruptOnce = false;
        return Effect.fail(
          new DotyposUncertain({
            operation: "createReservation",
            reason: "timeout",
          })
        );
      })
    );

  await Effect.runPromise(
    Effect.gen(function* () {
      const start = getCurrentWorkspaceDate().add({ days: 1 });
      const purchase = yield* record(start);
      const initial = yield* readUnlimitedPassDays(purchase.id);
      const attempt = yield* Effect.result(createUnlimitedPassHolds(purchase));
      expect(Result.isFailure(attempt)).toBe(true);
      expect(provider.reservations.size).toBeGreaterThan(0);
      const incomplete = yield* Effect.result(
        reconfirmUnlimitedPassHolds(purchase)
      );
      expect(Result.isFailure(incomplete)).toBe(true);

      yield* createUnlimitedPassHolds(purchase);
      yield* reconfirmUnlimitedPassHolds(purchase);
      const missing = yield* Effect.result(
        reconfirmUnlimitedPassHolds(purchase).pipe(
          Effect.provideService(DotyposService, {
            ...provider.service,
            getReservationsByIds: () => Effect.succeed(new Map()),
          })
        )
      );
      expect(missing).toEqual(
        Result.fail(expect.objectContaining({ reason: "unfinished" }))
      );
      expect(provider.reservations.size).toBe(unlimitedPassDays);
      expect(
        (yield* readUnlimitedPassDays(purchase.id)).map(({ id }) => id)
      ).toEqual(initial.map(({ id }) => id));

      const now = Temporal.Now.instant();
      const { db } = yield* WorkspaceDatabase;
      const attemptId = paymentAttemptIdSchema.make(crypto.randomUUID());
      yield* db.insert(paymentAttempts).values({
        id: attemptId,
        orderId: purchase.id,
        provider: "mock",
        providerOrderId: "fixture-ambiguous-holds-payment",
        state: "paid",
        amountValue: 599_000,
        amountExponent: 2,
        currency: "CZK",
      });
      yield* db
        .update(orders)
        .set({
          paymentState: "paid",
          activePaymentAttemptId: attemptId,
          paidAt: now,
          updatedAt: now,
        })
        .where(eq(orders.id, purchase.id));
      expect(yield* settlePassPurchase(purchase.id)).toBeUndefined();
      yield* confirmUnlimitedPassDays(purchase);
      yield* confirmUnlimitedPassDays(purchase);
      expect((yield* settlePassPurchase(purchase.id, attemptId))?.status).toBe(
        "active"
      );
      expect(
        [...provider.reservations.values()].every(
          (row) => row.status === "CONFIRMED"
        )
      ).toBe(true);

      yield* releaseUnlimitedPassDays({
        ...purchase,
        status: "withdrawn",
        accessEndsOn: date(start.add({ days: 1 })),
      });
      const days = yield* readUnlimitedPassDays(purchase.id);
      expect(days[0]?.reservationState).toBe("confirmed");
      expect(
        days.slice(1).every((row) => row.reservationState === "cancelled")
      ).toBe(true);
    }).pipe(
      Effect.provide(database!.layer),
      Effect.provideService(DotyposService, {
        ...provider.service,
        createReservation,
      })
    )
  );
});
