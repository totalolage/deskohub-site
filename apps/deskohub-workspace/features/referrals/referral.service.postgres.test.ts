import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import {
  type DotyposCustomerId,
  type DotyposReservation,
  type DotyposReservationId,
  DotyposService,
  DotyposUnavailable,
} from "@deskohub/dotypos";
import { Cause, Effect, Exit, Layer, Result } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { WorkspaceDatabaseAdvisoryLock } from "@/db/postgres-advisory-lock";
import {
  promotionCodes,
  referralAttributions,
  referralCodes,
} from "@/db/schema";
import { isDatabaseQueryError } from "@/db/sql-constraint";
import { CustomerAccountLinkRepository } from "@/features/account/backend/customer-account-link.repository";
import {
  accountLinksFailingAt,
  unreachableAccountLinks,
} from "@/features/account/backend/customer-account-link.test-utils";
import { CustomerAccountSections } from "@/features/account/backend/customer-account-sections";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import {
  signedInAuthentication,
  unreachableSessionAuthentication,
} from "@/features/account/backend/customer-authentication.test-utils";
import {
  type CustomerAccountId,
  customerAccountIdSchema,
} from "@/features/account/customer-account";
import { canonicalPromotionCodeSchema } from "@/features/discounts/persistence-contracts";
import { ReferralReleaseGate } from "@/features/referrals/referral-release-gate";
import { currencyCZK } from "@/shared/money/currencies";
import { connectUnreachableWorkspaceDatabase } from "@/shared/testing/unreachable-workspace-database.test-utils";
import {
  collectDatabaseQueryLogs,
  expectQueryLogsToOmit,
} from "@/shared/testing/workspace-database-query-log.test-utils";
import {
  type FixtureAccountOptions,
  workspaceFixtures,
} from "@/shared/testing/workspace-fixtures.test-utils";
import {
  holdPostgresTransaction,
  waitForAdvisoryLockWaiter,
} from "@/shared/testing/workspace-postgres-lock-waiters.test-utils";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { ReferralService } from "./referral.service";
import { getReferralBenefitIds } from "./referral-benefits";

const testDatabase = await connectWorkspacePostgresTestDatabase();
const uniqueId = () => crypto.randomUUID();
const uniqueDotyposId = () =>
  `${Math.floor(Math.random() * 900_000) + 100_000}${Math.floor(
    Math.random() * 900
  )}` as DotyposCustomerId;

const insertAuthUser = (
  accountId: CustomerAccountId,
  options: Omit<FixtureAccountOptions, "id"> = {}
) =>
  Effect.runPromise(
    workspaceFixtures(testDatabase!.db).account("referral", {
      id: accountId,
      verified: false,
      ...options,
    })
  );

const insertReferralFixture = async (input: {
  readonly inviteeCustomerId: DotyposCustomerId;
  readonly ownerCustomerId: DotyposCustomerId;
  readonly code: string;
}) => {
  const [promotion] = await Effect.runPromise(
    testDatabase!.db
      .insert(promotionCodes)
      .values({
        kind: "referral",
        code: canonicalPromotionCodeSchema.make(input.code),
        enabled: true,
      })
      .returning({ id: promotionCodes.id })
  );
  await Effect.runPromise(
    testDatabase!.db.insert(referralCodes).values({
      promotionCodeId: promotion!.id,
      referrerDotyposCustomerId: input.ownerCustomerId,
    })
  );
  await Effect.runPromise(
    testDatabase!.db.insert(referralAttributions).values({
      invitedDotyposCustomerId: input.inviteeCustomerId,
      referrerDotyposCustomerId: input.ownerCustomerId,
      promotionCodeId: promotion!.id,
    })
  );
  return {
    promotionCodeId: promotion!.id,
    cleanup: async () => {
      await testDatabase!.pool.query(
        "delete from referral_attributions where invited_dotypos_customer_id = $1",
        [input.inviteeCustomerId]
      );
      await testDatabase!.pool.query(
        "delete from referral_codes where promotion_code_id = $1",
        [promotion!.id]
      );
      await testDatabase!.pool.query(
        "delete from promotion_codes where id = $1",
        [promotion!.id]
      );
    },
  };
};

const makeLiveConfirmedReservation = (
  id: DotyposReservationId,
  endDate = Temporal.Now.instant().subtract({ hours: 24 }).toString()
) =>
  ({
    id,
    status: "CONFIRMED",
    endDate,
  }) as DotyposReservation;

const makeReferralLayer = (
  identity: {
    readonly accountId: CustomerAccountId;
    readonly dotyposCustomerId: DotyposCustomerId;
  },
  /** Dotypos reservations listed for each customer. */
  reservationsOf: (
    customerId: DotyposCustomerId
  ) => readonly DotyposReservation[] = () => [],
  listReservations: DotyposService["Service"]["listReservations"] = ({
    customerId,
  }) => Effect.succeed(reservationsOf(customerId)),
  /** Whether the `referrals` feature flag releases the program. */
  released = true
) => {
  const databaseLayer = Layer.succeed(
    WorkspaceDatabase,
    WorkspaceDatabase.make(testDatabase!.db)
  );
  const lockLayer = WorkspaceDatabaseAdvisoryLock.makeLayer(testDatabase!.pool);
  const accountLinksLayer = CustomerAccountLinkRepository.Default.pipe(
    Layer.provide(databaseLayer)
  );
  const authenticationLayer = signedInAuthentication(identity.accountId);

  return ReferralService.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        ReferralReleaseGate.fromDecision(released),
        databaseLayer,
        lockLayer,
        accountLinksLayer,
        authenticationLayer,
        CustomerAccountSections.Default.pipe(
          Layer.provide(
            Layer.mergeAll(authenticationLayer, accountLinksLayer, lockLayer)
          )
        ),
        Layer.mock(DotyposService, {
          listReservations,
        } as Partial<DotyposService["Service"]>)
      )
    )
  );
};

const insertLinkedAccount = async (dotyposCustomerId: DotyposCustomerId) => {
  const accountId = customerAccountIdSchema.make(uniqueId());
  await insertAuthUser(accountId, { linkedCustomer: dotyposCustomerId });
  return accountId;
};

/**
 * Seeds one synthetic booking for a customer with a single 1,000.00 payment
 * attempt and the given discount applications, applied in sequence.
 */
const insertDiscountedBooking = async (input: {
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly attempt: "paid" | "expired" | "refunded" | "refund_required";
  /** Refunded minor units when the attempt is refunded; the full payment by default. */
  readonly refundedAmountValue?: number;
  readonly currency?: "CZK" | "EUR" | "USD";
  readonly applications: readonly {
    readonly publicDiscountId: string;
    readonly amountValue: number;
  }[];
}) => {
  const attemptId = `referral-savings-attempt-${uniqueId()}`;
  const paid = input.attempt !== "expired";
  const { id: reservationId } = await Effect.runPromise(
    workspaceFixtures(testDatabase!.db).reservation({
      stage: paid
        ? { reservation: "confirmed", payment: "paid" }
        : { reservation: "cancelled", payment: "expired" },
      customer: input.dotyposCustomerId,
    })
  );
  await testDatabase!.pool.query(
    `insert into payment_attempts (id, workspace_reservation_id, provider, provider_order_id, state, failure_code, refund_state, refunded_amount_value, refunded_at, amount_value, amount_exponent, currency)
     values ($1, $2, 'nexi', $3, $4, $5, $6, $7, $8, 100000, 2, $9)`,
    [
      attemptId,
      reservationId,
      `order-${uniqueId()}`,
      paid ? "paid" : "expired",
      paid ? null : "payment_abandoned_after_provider_cutoff",
      { refunded: "refunded", refund_required: "required" }[
        input.attempt as "refunded" | "refund_required"
      ] ?? "not_required",
      input.attempt === "refunded"
        ? (input.refundedAmountValue ?? 100000)
        : null,
      input.attempt === "refunded" ? new Date().toISOString() : null,
      input.currency ?? "CZK",
    ]
  );
  let subtotal = 200000;
  for (const [sequence, application] of input.applications.entries()) {
    await testDatabase!.pool.query(
      `insert into discount_applications (payment_attempt_id, workspace_reservation_id, sequence, public_discount_id, label, adjustment, product_identity, subtotal_before_value, subtotal_before_exponent, subtotal_before_currency, applied_amount_value, applied_amount_exponent, applied_amount_currency, subtotal_after_value, subtotal_after_exponent, subtotal_after_currency, provenance)
       values ($1, $2, $3, $4, 'Synthetic', '{}', '{}', $5::int, 2, $7, $6::int, 2, $7, $5::int - $6::int, 2, $7, '{}')`,
      [
        attemptId,
        reservationId,
        sequence,
        application.publicDiscountId,
        subtotal,
        application.amountValue,
        input.currency ?? "CZK",
      ]
    );
    subtotal -= application.amountValue;
  }
};

const deleteBookings = async (customerIds: readonly DotyposCustomerId[]) => {
  const reservations = `select id from workspace_reservations where dotypos_customer_id = any($1)`;
  await testDatabase!.pool.query(
    `delete from discount_applications where workspace_reservation_id in (${reservations})`,
    [customerIds]
  );
  await testDatabase!.pool.query(
    `delete from payment_attempts where workspace_reservation_id in (${reservations})`,
    [customerIds]
  );
  await testDatabase!.pool.query(
    `delete from workspace_reservations where dotypos_customer_id = any($1)`,
    [customerIds]
  );
};

const getAccountSummary = (
  identity: {
    readonly accountId: CustomerAccountId;
    readonly dotyposCustomerId: DotyposCustomerId;
  },
  reservations: (
    customerId: DotyposCustomerId
  ) => readonly DotyposReservation[] = () => []
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const referrals = yield* ReferralService;
      return yield* referrals.getAccountSummary({
        customerAccountId: identity.accountId,
        dotyposCustomerId: identity.dotyposCustomerId,
      });
    }).pipe(Effect.provide(makeReferralLayer(identity, reservations)))
  );

describe.skipIf(!testDatabase)("ReferralService on disposable Postgres", () => {
  test("requires an active referrer even for an existing same-referrer attribution after a paid booking", async () => {
    const inviteeAccountId = customerAccountIdSchema.make(uniqueId());
    const ownerAccountId = customerAccountIdSchema.make(uniqueId());
    const inviteeCustomerId = uniqueDotyposId();
    const ownerCustomerId = uniqueDotyposId();
    const code = "RFL12345";
    let promotionCodeId: string | undefined;

    await insertAuthUser(inviteeAccountId, {
      linkedCustomer: inviteeCustomerId,
    });
    await insertAuthUser(ownerAccountId, { linkedCustomer: ownerCustomerId });

    try {
      const [promotion] = await Effect.runPromise(
        testDatabase!.db
          .insert(promotionCodes)
          .values({
            kind: "referral",
            code: canonicalPromotionCodeSchema.make(code),
            enabled: true,
          })
          .returning({ id: promotionCodes.id })
      );
      promotionCodeId = promotion!.id;
      await Effect.runPromise(
        testDatabase!.db.insert(referralCodes).values({
          promotionCodeId: promotion!.id,
          referrerDotyposCustomerId: ownerCustomerId,
        })
      );
      await Effect.runPromise(
        testDatabase!.db.insert(referralAttributions).values({
          invitedDotyposCustomerId: inviteeCustomerId,
          referrerDotyposCustomerId: ownerCustomerId,
          promotionCodeId: promotion!.id,
        })
      );
      await insertPaidBooking(inviteeCustomerId);

      const activeRetry = await Effect.runPromise(
        Effect.gen(function* () {
          const referrals = yield* ReferralService;
          return yield* referrals.acceptReferral({
            code,
            customerAccountId: inviteeAccountId,
            dotyposCustomerId: inviteeCustomerId,
          });
        }).pipe(
          Effect.provide(
            makeReferralLayer({
              accountId: inviteeAccountId,
              dotyposCustomerId: inviteeCustomerId,
            })
          )
        )
      );
      expect(activeRetry).toEqual({ kind: "already_accepted" });

      await testDatabase!.pool.query(
        `update auth."user" set deletion_requested_at = now() where id = $1`,
        [ownerAccountId]
      );
      const unavailableRetry = await Effect.runPromise(
        Effect.gen(function* () {
          const referrals = yield* ReferralService;
          return yield* Effect.result(
            referrals.acceptReferral({
              code,
              customerAccountId: inviteeAccountId,
              dotyposCustomerId: inviteeCustomerId,
            })
          );
        }).pipe(
          Effect.provide(
            makeReferralLayer({
              accountId: inviteeAccountId,
              dotyposCustomerId: inviteeCustomerId,
            })
          )
        )
      );
      expect(unavailableRetry).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "ReferralError", reason: "unavailable" },
      });
    } finally {
      await testDatabase!.pool.query(
        `delete from referral_attributions where invited_dotypos_customer_id = $1`,
        [inviteeCustomerId]
      );
      await testDatabase!.pool.query(
        `delete from workspace_reservations where dotypos_customer_id = $1`,
        [inviteeCustomerId]
      );
      if (promotionCodeId) {
        await testDatabase!.pool.query(
          `delete from referral_codes where promotion_code_id = $1`,
          [promotionCodeId]
        );
        await testDatabase!.pool.query(
          `delete from promotion_codes where id = $1`,
          [promotionCodeId]
        );
      }
      await testDatabase!.pool.query(
        `delete from auth."user" where id = any($1)`,
        [[inviteeAccountId, ownerAccountId]]
      );
      await testDatabase!.pool.query(
        "delete from customer_accounts where id = any($1)",
        [[inviteeAccountId, ownerAccountId]]
      );
    }
  });

  test("serializes concurrent opposite attributions without admitting a cycle", async () => {
    const accountA = customerAccountIdSchema.make(uniqueId());
    const accountB = customerAccountIdSchema.make(uniqueId());
    const customerA = uniqueDotyposId();
    const customerB = uniqueDotyposId();
    const codeA = canonicalPromotionCodeSchema.make(
      `RFL${uniqueId().replaceAll("-", "").slice(0, 12).toUpperCase()}`
    );
    const codeB = canonicalPromotionCodeSchema.make(
      `RFL${uniqueId().replaceAll("-", "").slice(0, 12).toUpperCase()}`
    );
    let promotionA: string | undefined;
    let promotionB: string | undefined;

    await insertAuthUser(accountA, { linkedCustomer: customerA });
    await insertAuthUser(accountB, { linkedCustomer: customerB });

    try {
      const [a] = await Effect.runPromise(
        testDatabase!.db
          .insert(promotionCodes)
          .values({ kind: "referral", code: codeA, enabled: true })
          .returning({ id: promotionCodes.id })
      );
      const [b] = await Effect.runPromise(
        testDatabase!.db
          .insert(promotionCodes)
          .values({ kind: "referral", code: codeB, enabled: true })
          .returning({ id: promotionCodes.id })
      );
      promotionA = a!.id;
      promotionB = b!.id;
      await Effect.runPromise(
        testDatabase!.db.insert(referralCodes).values([
          {
            promotionCodeId: promotionA,
            referrerDotyposCustomerId: customerA,
          },
          {
            promotionCodeId: promotionB,
            referrerDotyposCustomerId: customerB,
          },
        ])
      );

      const outcomes = await Promise.all([
        Effect.runPromise(
          Effect.gen(function* () {
            const referrals = yield* ReferralService;
            return yield* Effect.result(
              referrals.acceptReferral({
                code: codeB,
                customerAccountId: accountA,
                dotyposCustomerId: customerA,
              })
            );
          }).pipe(
            Effect.provide(
              makeReferralLayer({
                accountId: accountA,
                dotyposCustomerId: customerA,
              })
            )
          )
        ),
        Effect.runPromise(
          Effect.gen(function* () {
            const referrals = yield* ReferralService;
            return yield* Effect.result(
              referrals.acceptReferral({
                code: codeA,
                customerAccountId: accountB,
                dotyposCustomerId: customerB,
              })
            );
          }).pipe(
            Effect.provide(
              makeReferralLayer({
                accountId: accountB,
                dotyposCustomerId: customerB,
              })
            )
          )
        ),
      ]);

      expect(outcomes.filter(({ _tag }) => _tag === "Success")).toHaveLength(1);
      expect(outcomes.filter(({ _tag }) => _tag === "Failure")).toHaveLength(1);
      const edges = await testDatabase!.pool.query(
        "select invited_dotypos_customer_id, referrer_dotypos_customer_id from referral_attributions where invited_dotypos_customer_id = any($1)",
        [[customerA, customerB]]
      );
      expect(edges.rows).toHaveLength(1);
      expect(
        edges.rows.some(
          (edge) =>
            edge.invited_dotypos_customer_id === customerA &&
            edge.referrer_dotypos_customer_id === customerB
        ) &&
          edges.rows.some(
            (edge) =>
              edge.invited_dotypos_customer_id === customerB &&
              edge.referrer_dotypos_customer_id === customerA
          )
      ).toBe(false);
    } finally {
      await testDatabase!.pool.query(
        "delete from referral_attributions where invited_dotypos_customer_id = any($1)",
        [[customerA, customerB]]
      );
      for (const promotionId of [promotionA, promotionB]) {
        if (!promotionId) continue;
        await testDatabase!.pool.query(
          "delete from referral_codes where promotion_code_id = $1",
          [promotionId]
        );
        await testDatabase!.pool.query(
          "delete from promotion_codes where id = $1",
          [promotionId]
        );
      }
      await testDatabase!.pool.query(
        'delete from auth."user" where id = any($1)',
        [[accountA, accountB]]
      );
      await testDatabase!.pool.query(
        "delete from customer_accounts where id = any($1)",
        [[accountA, accountB]]
      );
    }
  });

  test("keeps a known unpaid hold distinct from an older confirmed booking without local evidence", async () => {
    const unpaidCustomer = uniqueDotyposId();
    const unpaidOwner = uniqueDotyposId();
    const unknownCustomer = uniqueDotyposId();
    const unknownOwner = uniqueDotyposId();
    const unpaidReservationId = ("unpaid-" +
      uniqueId()) as DotyposReservationId;
    const unpaidReferral = await insertReferralFixture({
      inviteeCustomerId: unpaidCustomer,
      ownerCustomerId: unpaidOwner,
      code: `RFL${uniqueId().replaceAll("-", "").slice(0, 12).toUpperCase()}`,
    });
    const unknownReferral = await insertReferralFixture({
      inviteeCustomerId: unknownCustomer,
      ownerCustomerId: unknownOwner,
      code: `RFL${uniqueId().replaceAll("-", "").slice(0, 12).toUpperCase()}`,
    });
    await Effect.runPromise(
      workspaceFixtures(testDatabase!.db).reservation({
        stage: { reservation: "held", payment: "failed" },
        customer: unpaidCustomer,
        overrides: { dotyposReservationId: unpaidReservationId },
      })
    );

    try {
      const unpaidCandidate = await Effect.runPromise(
        Effect.gen(function* () {
          const referrals = yield* ReferralService;
          return yield* referrals.resolveInvitationCandidate({
            dotyposCustomerId: unpaidCustomer,
            locale: "en-US",
          });
        }).pipe(
          Effect.provide(
            makeReferralLayer(
              {
                accountId: customerAccountIdSchema.make(uniqueId()),
                dotyposCustomerId: unpaidCustomer,
              },
              () => [makeLiveConfirmedReservation(unpaidReservationId)]
            )
          )
        )
      );
      const unknownCandidate = await Effect.runPromise(
        Effect.gen(function* () {
          const referrals = yield* ReferralService;
          return yield* referrals.resolveInvitationCandidate({
            dotyposCustomerId: unknownCustomer,
            locale: "en-US",
          });
        }).pipe(
          Effect.provide(
            makeReferralLayer(
              {
                accountId: customerAccountIdSchema.make(uniqueId()),
                dotyposCustomerId: unknownCustomer,
              },
              () => [
                makeLiveConfirmedReservation(
                  `untracked-${uniqueId()}` as DotyposReservationId
                ),
              ]
            )
          )
        )
      );

      expect(unpaidCandidate?.claim?.kind).toBe("referral_invitation");
      expect(unknownCandidate).toBeUndefined();
    } finally {
      await testDatabase!.pool.query(
        "delete from workspace_reservations where dotypos_customer_id = $1",
        [unpaidCustomer]
      );
      await unpaidReferral.cleanup();
      await unknownReferral.cleanup();
    }
  });

  test("retains local paid first-booking evidence after auth deletion and relinking", async () => {
    const oldAccountId = customerAccountIdSchema.make(uniqueId());
    const newAccountId = customerAccountIdSchema.make(uniqueId());
    const inviteeCustomerId = uniqueDotyposId();
    const ownerCustomerId = uniqueDotyposId();
    const ownerAccountId = customerAccountIdSchema.make(uniqueId());
    const paidReservationId = `paid-${uniqueId()}` as DotyposReservationId;
    const referral = await insertReferralFixture({
      inviteeCustomerId,
      ownerCustomerId,
      code: `RFL${uniqueId().replaceAll("-", "").slice(0, 12).toUpperCase()}`,
    });
    await insertAuthUser(oldAccountId, { linkedCustomer: inviteeCustomerId });
    await insertAuthUser(newAccountId);
    await insertAuthUser(ownerAccountId, { linkedCustomer: ownerCustomerId });
    await Effect.runPromise(
      workspaceFixtures(testDatabase!.db).reservation({
        stage: { reservation: "confirmed", payment: "paid" },
        customer: inviteeCustomerId,
        overrides: { dotyposReservationId: paidReservationId },
      })
    );

    try {
      await testDatabase!.pool.query('delete from auth."user" where id = $1', [
        oldAccountId,
      ]);
      await testDatabase!.pool.query(
        "update customer_accounts set dotypos_customer_id = null where id = $1",
        [oldAccountId]
      );
      await testDatabase!.pool.query(
        "update customer_accounts set dotypos_customer_id = $2 where id = $1",
        [newAccountId, inviteeCustomerId]
      );

      const candidate = await Effect.runPromise(
        Effect.gen(function* () {
          const referrals = yield* ReferralService;
          return yield* referrals.resolveInvitationCandidate({
            dotyposCustomerId: inviteeCustomerId,
            locale: "en-US",
          });
        }).pipe(
          Effect.provide(
            makeReferralLayer({
              accountId: newAccountId,
              dotyposCustomerId: inviteeCustomerId,
            })
          )
        )
      );
      const link = await testDatabase!.pool.query(
        "select id from customer_accounts where dotypos_customer_id = $1",
        [inviteeCustomerId]
      );

      expect(link.rows).toEqual([{ id: newAccountId }]);
      expect(candidate).toBeUndefined();
    } finally {
      await testDatabase!.pool.query(
        "delete from workspace_reservations where dotypos_customer_id = $1",
        [inviteeCustomerId]
      );
      await referral.cleanup();
      await testDatabase!.pool.query(
        'delete from auth."user" where id = any($1)',
        [[newAccountId, ownerAccountId]]
      );
      await testDatabase!.pool.query(
        "delete from customer_accounts where id = any($1)",
        [[oldAccountId, newAccountId, ownerAccountId]]
      );
    }
  });

  test("finds only currently usable referral codes without issuing codes or attribution", async () => {
    const uniqueCode = () =>
      `RFA${crypto.randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
    const promotionCodeIds: string[] = [];
    const accountIds: CustomerAccountId[] = [];
    const insertCode = async (input: {
      readonly owner: "active" | "deletion-requested" | "unlinked";
      readonly kind?: "referral" | "discount";
      readonly enabled?: boolean;
      readonly validFrom?: Temporal.Instant;
      readonly validUntil?: Temporal.Instant;
    }) => {
      const code = uniqueCode();
      const ownerCustomerId = uniqueDotyposId();
      const [promotion] = await Effect.runPromise(
        testDatabase!.db
          .insert(promotionCodes)
          .values({
            kind: input.kind ?? "referral",
            code: canonicalPromotionCodeSchema.make(code),
            enabled: input.enabled ?? true,
            validFrom: input.validFrom,
            validUntil: input.validUntil,
          })
          .returning({ id: promotionCodes.id })
      );
      promotionCodeIds.push(promotion!.id);
      if ((input.kind ?? "referral") === "referral") {
        await Effect.runPromise(
          testDatabase!.db.insert(referralCodes).values({
            promotionCodeId: promotion!.id,
            referrerDotyposCustomerId: ownerCustomerId,
          })
        );
      }
      if (input.owner !== "unlinked") {
        const ownerAccountId = customerAccountIdSchema.make(uniqueId());
        accountIds.push(ownerAccountId);
        await insertAuthUser(ownerAccountId, {
          linkedCustomer: ownerCustomerId,
          deletionRequested: input.owner === "deletion-requested",
        });
      }
      return code;
    };

    try {
      const now = Temporal.Now.instant();
      const available = await insertCode({ owner: "active" });
      const unavailable = await Promise.all([
        insertCode({ owner: "active", enabled: false }),
        insertCode({
          owner: "active",
          validUntil: now.subtract({ hours: 1 }),
        }),
        insertCode({ owner: "active", validFrom: now.add({ hours: 1 }) }),
        insertCode({ owner: "unlinked" }),
        insertCode({ owner: "deletion-requested" }),
        insertCode({ owner: "active", kind: "discount" }),
      ]);
      const countRows = async () => {
        const result = await testDatabase!.pool.query<{
          readonly codes: string;
          readonly attributions: string;
        }>(
          `select (select count(*) from referral_codes) as codes,
                  (select count(*) from referral_attributions) as attributions`
        );
        return result.rows[0];
      };
      const before = await countRows();

      const lookups = await Effect.runPromise(
        Effect.gen(function* () {
          const referrals = yield* ReferralService;
          return yield* Effect.forEach(
            [` ${available.toLowerCase()} `, ...unavailable, "not a code"],
            (code) => referrals.findAvailableCode({ code })
          );
        }).pipe(
          Effect.provide(
            makeReferralLayer({
              accountId: customerAccountIdSchema.make(uniqueId()),
              dotyposCustomerId: uniqueDotyposId(),
            })
          )
        )
      );

      expect(lookups).toEqual([
        available,
        ...unavailable.map(() => undefined),
        undefined,
      ]);
      expect(await countRows()).toEqual(before);
    } finally {
      await testDatabase!.pool.query(
        "delete from promotion_codes where id = any($1)",
        [promotionCodeIds]
      );
      await testDatabase!.pool.query(
        'delete from auth."user" where id = any($1)',
        [accountIds]
      );
      await testDatabase!.pool.query(
        "delete from customer_accounts where id = any($1)",
        [accountIds]
      );
    }
  });

  test("summarizes all and currently eligible referrals with the referral discounts saved on paid bookings", async () => {
    const referrerCustomerId = uniqueDotyposId();
    const recentInvitee = uniqueDotyposId();
    const lapsedInvitee = uniqueDotyposId();
    const newInvitee = uniqueDotyposId();
    const otherCustomer = uniqueDotyposId();
    const referrerAccountId = await insertLinkedAccount(referrerCustomerId);
    const referral = await insertReferralFixture({
      inviteeCustomerId: recentInvitee,
      ownerCustomerId: referrerCustomerId,
      code: `RFL${uniqueId().replaceAll("-", "").slice(0, 12).toUpperCase()}`,
    });
    await testDatabase!.pool.query(
      `insert into referral_attributions (invited_dotypos_customer_id, referrer_dotypos_customer_id, promotion_code_id)
       values ($1, $3, $4), ($2, $3, $4)`,
      [lapsedInvitee, newInvitee, referrerCustomerId, referral.promotionCodeId]
    );
    const inviteeBookings = new Map<DotyposCustomerId, DotyposReservationId>(
      [recentInvitee, lapsedInvitee].map((customerId) => [
        customerId,
        `invitee-booking-${uniqueId()}` as DotyposReservationId,
      ])
    );
    await Effect.runPromise(
      workspaceFixtures(testDatabase!.db).reservations(
        [...inviteeBookings].map(([customerId, bookingId]) => ({
          stage: { reservation: "confirmed", payment: "paid" },
          customer: customerId,
          overrides: { dotyposReservationId: bookingId },
        }))
      )
    );
    const referrerDiscountId =
      getReferralBenefitIds(referrerCustomerId).referrer;
    await insertDiscountedBooking({
      dotyposCustomerId: referrerCustomerId,
      attempt: "paid",
      applications: [
        { publicDiscountId: "synthetic-ordinary-discount", amountValue: 1000 },
        {
          publicDiscountId:
            getReferralBenefitIds(referrerCustomerId).invitation,
          amountValue: 3000,
        },
        { publicDiscountId: referrerDiscountId, amountValue: 1234 },
      ],
    });
    await insertDiscountedBooking({
      dotyposCustomerId: referrerCustomerId,
      attempt: "paid",
      applications: [
        { publicDiscountId: referrerDiscountId, amountValue: 5000 },
      ],
    });
    await insertDiscountedBooking({
      dotyposCustomerId: referrerCustomerId,
      attempt: "paid",
      currency: "EUR",
      applications: [
        { publicDiscountId: referrerDiscountId, amountValue: 200 },
      ],
    });
    await insertDiscountedBooking({
      dotyposCustomerId: referrerCustomerId,
      attempt: "expired",
      applications: [
        { publicDiscountId: referrerDiscountId, amountValue: 9900 },
      ],
    });
    // A quarter of this payment was refunded, so a quarter of its referral
    // discount no longer counts as saved.
    await insertDiscountedBooking({
      dotyposCustomerId: referrerCustomerId,
      attempt: "refunded",
      refundedAmountValue: 25000,
      applications: [
        { publicDiscountId: referrerDiscountId, amountValue: 4000 },
      ],
    });
    await insertDiscountedBooking({
      dotyposCustomerId: referrerCustomerId,
      attempt: "refunded",
      currency: "USD",
      applications: [
        { publicDiscountId: referrerDiscountId, amountValue: 500 },
      ],
    });
    await insertDiscountedBooking({
      dotyposCustomerId: referrerCustomerId,
      attempt: "refund_required",
      applications: [
        { publicDiscountId: referrerDiscountId, amountValue: 700 },
      ],
    });
    await insertDiscountedBooking({
      dotyposCustomerId: otherCustomer,
      attempt: "paid",
      applications: [
        {
          publicDiscountId: getReferralBenefitIds(otherCustomer).referrer,
          amountValue: 7000,
        },
      ],
    });

    try {
      const now = Temporal.Now.instant();
      const summary = await getAccountSummary(
        { accountId: referrerAccountId, dotyposCustomerId: referrerCustomerId },
        (customerId) => {
          const bookingId = inviteeBookings.get(customerId);
          if (!bookingId) return [];
          return [
            makeLiveConfirmedReservation(
              bookingId,
              (customerId === recentInvitee
                ? now.subtract({ hours: 24 })
                : now.subtract({ hours: 24 * 40 })
              ).toString()
            ),
          ];
        }
      );

      expect(summary).toMatchObject({
        code: expect.any(String),
        inviteeCount: 3,
        eligibleInviteeCount: 1,
        discount: "5",
        savings: [
          { value: 12234, exponent: 2, currency: "CZK" },
          { value: 200, exponent: 2, currency: "EUR" },
        ],
      });
    } finally {
      await deleteBookings([
        referrerCustomerId,
        recentInvitee,
        lapsedInvitee,
        otherCustomer,
      ]);
      await testDatabase!.pool.query(
        "delete from referral_attributions where invited_dotypos_customer_id = any($1)",
        [[lapsedInvitee, newInvitee]]
      );
      await referral.cleanup();
      await testDatabase!.pool.query('delete from auth."user" where id = $1', [
        referrerAccountId,
      ]);
      await testDatabase!.pool.query(
        "delete from customer_accounts where id = $1",
        [referrerAccountId]
      );
    }
  });

  test("keeps the referral code it issues out of the query log", async () => {
    const dotyposCustomerId = uniqueDotyposId();
    const accountId = await insertLinkedAccount(dotyposCustomerId);
    let issuedCode: string | undefined;

    try {
      const logs = await collectDatabaseQueryLogs(
        Effect.gen(function* () {
          const referrals = yield* ReferralService;
          const summary = yield* referrals.getAccountSummary({
            customerAccountId: accountId,
            dotyposCustomerId,
          });
          issuedCode = summary.code;
        }).pipe(
          Effect.provide(makeReferralLayer({ accountId, dotyposCustomerId }))
        )
      );

      const { rows } = await testDatabase!.pool.query<{ code: string }>(
        `select p.code from referral_codes r
           join promotion_codes p on p.id = r.promotion_code_id
           where r.referrer_dotypos_customer_id = $1`,
        [dotyposCustomerId]
      );
      expect(issuedCode).toBeDefined();
      expect(rows.map(({ code }) => code)).toEqual([issuedCode!]);
      expectQueryLogsToOmit({ logs, values: [issuedCode!] });
    } finally {
      const { rows } = await testDatabase!.pool.query<{
        promotion_code_id: string;
      }>(
        "delete from referral_codes where referrer_dotypos_customer_id = $1 returning promotion_code_id",
        [dotyposCustomerId]
      );
      await testDatabase!.pool.query(
        "delete from promotion_codes where id = any($1)",
        [rows.map(({ promotion_code_id }) => promotion_code_id)]
      );
      await testDatabase!.pool.query('delete from auth."user" where id = $1', [
        accountId,
      ]);
      await testDatabase!.pool.query(
        "delete from customer_accounts where id = $1",
        [accountId]
      );
    }
  });
});

const createActiveReferrer = async () => {
  const accountId = customerAccountIdSchema.make(uniqueId());
  const dotyposCustomerId = uniqueDotyposId();
  const code = `RFC${uniqueId().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
  await insertAuthUser(accountId, { linkedCustomer: dotyposCustomerId });
  const [promotion] = await Effect.runPromise(
    testDatabase!.db
      .insert(promotionCodes)
      .values({
        kind: "referral",
        code: canonicalPromotionCodeSchema.make(code),
        enabled: true,
      })
      .returning({ id: promotionCodes.id })
  );
  await Effect.runPromise(
    testDatabase!.db.insert(referralCodes).values({
      promotionCodeId: promotion!.id,
      referrerDotyposCustomerId: dotyposCustomerId,
    })
  );
  return {
    accountId,
    dotyposCustomerId,
    code: canonicalPromotionCodeSchema.make(code),
    promotionCodeId: promotion!.id,
    cleanup: async () => {
      await testDatabase!.pool.query(
        "delete from referral_attributions where promotion_code_id = $1",
        [promotion!.id]
      );
      await testDatabase!.pool.query(
        "delete from promotion_codes where id = $1",
        [promotion!.id]
      );
      await testDatabase!.pool.query('delete from auth."user" where id = $1', [
        accountId,
      ]);
      await testDatabase!.pool.query(
        "delete from customer_accounts where id = $1",
        [accountId]
      );
    },
  };
};

const insertPaidBooking = (dotyposCustomerId: DotyposCustomerId) =>
  Effect.runPromise(
    workspaceFixtures(testDatabase!.db).reservation({
      stage: { reservation: "confirmed", payment: "paid" },
      customer: dotyposCustomerId,
    })
  );

/** A held booking whose payment has started but not completed. */
const insertPendingBooking = (dotyposCustomerId: DotyposCustomerId) =>
  Effect.runPromise(
    workspaceFixtures(testDatabase!.db)
      .reservation({
        stage: { reservation: "held", payment: "pending" },
        customer: dotyposCustomerId,
      })
      .pipe(Effect.map((reservation) => reservation.id))
  );

const runReferrals = <A, E>(
  use: (referrals: ReferralService["Service"]) => Effect.Effect<A, E>,
  layer = makeReferralLayer({
    accountId: customerAccountIdSchema.make(uniqueId()),
    dotyposCustomerId: uniqueDotyposId(),
  })
) =>
  Effect.runPromise(
    Effect.result(
      Effect.gen(function* () {
        return yield* use(yield* ReferralService);
      }).pipe(Effect.provide(layer))
    )
  );

describe.skipIf(!testDatabase)(
  "ReferralService checkout referral evaluation on disposable Postgres",
  () => {
    test("lets a customer without a referral at completion take one at the first checkout, then rejects it after the first paid order", async () => {
      const referrer = await createActiveReferrer();
      // Completed profile without a referral: a linked account, no attribution.
      const inviteeAccountId = customerAccountIdSchema.make(uniqueId());
      const inviteeCustomerId = uniqueDotyposId();
      await insertAuthUser(inviteeAccountId, {
        linkedCustomer: inviteeCustomerId,
      });
      try {
        const evaluate = () =>
          runReferrals((referrals) =>
            referrals.evaluateCheckoutReferral({
              code: referrer.code.toLowerCase(),
              dotyposCustomerId: inviteeCustomerId,
            })
          );
        const price = (referralCode?: typeof referrer.code) =>
          runReferrals((referrals) =>
            referrals.resolveInvitationCandidate({
              dotyposCustomerId: inviteeCustomerId,
              locale: "en-US",
              ...(referralCode && { referralCode }),
            })
          );

        expect(await evaluate()).toMatchObject({
          _tag: "Success",
          success: { kind: "eligible", code: referrer.code },
        });
        expect(await price(referrer.code)).toMatchObject({
          _tag: "Success",
          success: {
            discount: {
              adjustment: { kind: "percentage", basisPoints: 1_500 },
            },
            claim: {
              kind: "referral_invitation",
              invitedDotyposCustomerId: inviteeCustomerId,
              referrerDotyposCustomerId: referrer.dotyposCustomerId,
              promotionCodeId: referrer.promotionCodeId,
            },
          },
        });
        expect(await price()).toMatchObject({
          _tag: "Success",
          success: undefined,
        });
        const attributions = await testDatabase!.pool.query(
          "select 1 from referral_attributions where invited_dotypos_customer_id = $1",
          [inviteeCustomerId]
        );
        expect(attributions.rows).toEqual([]);

        await insertPaidBooking(inviteeCustomerId);

        expect(await evaluate()).toMatchObject({
          _tag: "Failure",
          failure: { _tag: "ReferralError", reason: "ineligible" },
        });
        expect(await price(referrer.code)).toMatchObject({
          _tag: "Success",
          success: undefined,
        });
      } finally {
        await testDatabase!.pool.query(
          "delete from workspace_reservations where dotypos_customer_id = $1",
          [inviteeCustomerId]
        );
        await testDatabase!.pool.query(
          'delete from auth."user" where id = $1',
          [inviteeAccountId]
        );
        await testDatabase!.pool.query(
          "delete from customer_accounts where id = $1",
          [inviteeAccountId]
        );
        await referrer.cleanup();
      }
    });

    test("evaluates guest, attributed, self, and cyclic checkout referrals without writing", async () => {
      const first = await createActiveReferrer();
      const second = await createActiveReferrer();
      const guestCustomerId = uniqueDotyposId();
      const attributedCustomerId = uniqueDotyposId();
      try {
        await Effect.runPromise(
          testDatabase!.db.insert(referralAttributions).values([
            {
              invitedDotyposCustomerId: attributedCustomerId,
              referrerDotyposCustomerId: first.dotyposCustomerId,
              promotionCodeId: first.promotionCodeId,
            },
            // first was invited by second, so second cannot be invited by first.
            {
              invitedDotyposCustomerId: first.dotyposCustomerId,
              referrerDotyposCustomerId: second.dotyposCustomerId,
              promotionCodeId: second.promotionCodeId,
            },
          ])
        );
        const evaluate = (code: string, dotyposCustomerId: DotyposCustomerId) =>
          runReferrals((referrals) =>
            referrals.evaluateCheckoutReferral({ code, dotyposCustomerId })
          );

        expect(await evaluate(first.code, guestCustomerId)).toMatchObject({
          _tag: "Success",
          success: { kind: "eligible" },
        });
        expect(await evaluate(first.code, attributedCustomerId)).toMatchObject({
          _tag: "Success",
          success: { kind: "already_accepted" },
        });
        expect(await evaluate(second.code, attributedCustomerId)).toMatchObject(
          {
            _tag: "Failure",
            failure: { reason: "already_attributed" },
          }
        );
        expect(
          await evaluate(first.code, first.dotyposCustomerId)
        ).toMatchObject({
          _tag: "Failure",
          failure: { reason: "self_referral" },
        });
        expect(
          await evaluate(first.code, second.dotyposCustomerId)
        ).toMatchObject({
          _tag: "Failure",
          failure: { reason: "cycle" },
        });
        expect(
          (
            await testDatabase!.pool.query(
              "select 1 from referral_attributions where invited_dotypos_customer_id = any($1)",
              [[guestCustomerId, second.dotyposCustomerId]]
            )
          ).rows
        ).toEqual([]);
      } finally {
        await first.cleanup();
        await second.cleanup();
      }
    });

    test("tells a pending first payment, a paid booking, and a cycle apart at acceptance", async () => {
      const referrer = await createActiveReferrer();
      const inviteeAccountId = customerAccountIdSchema.make(uniqueId());
      const inviteeCustomerId = uniqueDotyposId();
      await insertAuthUser(inviteeAccountId, {
        linkedCustomer: inviteeCustomerId,
      });
      const invitee = {
        accountId: inviteeAccountId,
        dotyposCustomerId: inviteeCustomerId,
      };
      let inviteePromotionId: string | undefined;
      try {
        const accept = (code: string, identity = invitee) =>
          runReferrals(
            (referrals) =>
              referrals.acceptReferral({
                code,
                customerAccountId: identity.accountId,
                dotyposCustomerId: identity.dotyposCustomerId,
              }),
            makeReferralLayer(identity)
          );

        const pendingId = await insertPendingBooking(inviteeCustomerId);
        expect(await accept(referrer.code)).toMatchObject({
          _tag: "Failure",
          failure: { _tag: "ReferralError", reason: "pending_payment" },
        });

        await testDatabase!.pool.query(
          "update workspace_reservations set payment_state = 'paid', paid_at = now() where id = $1",
          [pendingId]
        );
        expect(await accept(referrer.code)).toMatchObject({
          _tag: "Failure",
          failure: { _tag: "ReferralError", reason: "ineligible" },
        });

        // The referrer was invited by the invitee, so the invitee's code
        // cannot refer the referrer back.
        const inviteeCode = canonicalPromotionCodeSchema.make(
          `RFC${uniqueId().replaceAll("-", "").slice(0, 10).toUpperCase()}`
        );
        const [inviteePromotion] = await Effect.runPromise(
          testDatabase!.db
            .insert(promotionCodes)
            .values({ kind: "referral", code: inviteeCode, enabled: true })
            .returning({ id: promotionCodes.id })
        );
        inviteePromotionId = inviteePromotion!.id;
        await Effect.runPromise(
          testDatabase!.db.insert(referralCodes).values({
            promotionCodeId: inviteePromotionId,
            referrerDotyposCustomerId: inviteeCustomerId,
          })
        );
        await Effect.runPromise(
          testDatabase!.db.insert(referralAttributions).values({
            invitedDotyposCustomerId: inviteeCustomerId,
            referrerDotyposCustomerId: referrer.dotyposCustomerId,
            promotionCodeId: referrer.promotionCodeId,
          })
        );
        expect(
          await accept(inviteeCode, {
            accountId: referrer.accountId,
            dotyposCustomerId: referrer.dotyposCustomerId,
          })
        ).toMatchObject({
          _tag: "Failure",
          failure: { _tag: "ReferralError", reason: "cycle" },
        });
      } finally {
        if (inviteePromotionId) {
          await testDatabase!.pool.query(
            "delete from promotion_codes where id = $1",
            [inviteePromotionId]
          );
        }
        await testDatabase!.pool.query(
          "delete from workspace_reservations where dotypos_customer_id = $1",
          [inviteeCustomerId]
        );
        await testDatabase!.pool.query(
          'delete from auth."user" where id = $1',
          [inviteeAccountId]
        );
        await testDatabase!.pool.query(
          "delete from customer_accounts where id = $1",
          [inviteeAccountId]
        );
        await referrer.cleanup();
      }
    });

    test("reports a referral as settled once attributed or after the first paid booking", async () => {
      const referrer = await createActiveReferrer();
      const openCustomer = uniqueDotyposId();
      const attributedCustomer = uniqueDotyposId();
      const paidCustomer = uniqueDotyposId();
      const settled = (dotyposCustomerId: DotyposCustomerId) =>
        runReferrals(
          (referrals) => referrals.hasSettledReferral({ dotyposCustomerId }),
          makeReferralLayer({
            accountId: customerAccountIdSchema.make(uniqueId()),
            dotyposCustomerId,
          })
        );
      try {
        await Effect.runPromise(
          testDatabase!.db.insert(referralAttributions).values({
            invitedDotyposCustomerId: attributedCustomer,
            referrerDotyposCustomerId: referrer.dotyposCustomerId,
            promotionCodeId: referrer.promotionCodeId,
          })
        );
        const pendingId = await insertPendingBooking(paidCustomer);

        expect(await settled(openCustomer)).toMatchObject({
          _tag: "Success",
          success: false,
        });
        expect(await settled(attributedCustomer)).toMatchObject({
          _tag: "Success",
          success: true,
        });
        // A payment still in progress keeps the window open.
        expect(await settled(paidCustomer)).toMatchObject({
          _tag: "Success",
          success: false,
        });
        await testDatabase!.pool.query(
          "update workspace_reservations set payment_state = 'paid', paid_at = now() where id = $1",
          [pendingId]
        );
        expect(await settled(paidCustomer)).toMatchObject({
          _tag: "Success",
          success: true,
        });
      } finally {
        await testDatabase!.pool.query(
          "delete from referral_attributions where invited_dotypos_customer_id = $1",
          [attributedCustomer]
        );
        await testDatabase!.pool.query(
          "delete from workspace_reservations where dotypos_customer_id = $1",
          [paidCustomer]
        );
        await referrer.cleanup();
      }
    });

    test("prices the referrer discount only for a referrer with eligible invitees and a subtotal left to reduce", async () => {
      const referrer = await createActiveReferrer();
      const loneReferrer = await createActiveReferrer();
      const invitee = uniqueDotyposId();
      const inviteeBooking =
        `invitee-booking-${uniqueId()}` as DotyposReservationId;
      const referrerCandidate = (
        dotyposCustomerId: DotyposCustomerId,
        remainingValue: number
      ) =>
        runReferrals(
          (referrals) =>
            referrals.resolveReferrerCandidate({
              dotyposCustomerId,
              locale: "en-US",
              remainingSubtotal: currencyCZK(remainingValue),
            }),
          makeReferralLayer(
            {
              accountId: customerAccountIdSchema.make(uniqueId()),
              dotyposCustomerId,
            },
            (customerId) =>
              customerId === invitee
                ? [makeLiveConfirmedReservation(inviteeBooking)]
                : []
          )
        );
      try {
        await Effect.runPromise(
          testDatabase!.db.insert(referralAttributions).values({
            invitedDotyposCustomerId: invitee,
            referrerDotyposCustomerId: referrer.dotyposCustomerId,
            promotionCodeId: referrer.promotionCodeId,
          })
        );
        await Effect.runPromise(
          workspaceFixtures(testDatabase!.db).reservation({
            stage: { reservation: "confirmed", payment: "paid" },
            customer: invitee,
            overrides: { dotyposReservationId: inviteeBooking },
          })
        );

        expect(
          await referrerCandidate(loneReferrer.dotyposCustomerId, 100_000)
        ).toMatchObject({ _tag: "Success", success: undefined });
        // Nothing is left to reduce, so the referrer discount prices nothing.
        expect(
          await referrerCandidate(referrer.dotyposCustomerId, 0)
        ).toMatchObject({ _tag: "Success", success: undefined });
        expect(
          await referrerCandidate(referrer.dotyposCustomerId, 100_000)
        ).toMatchObject({
          _tag: "Success",
          success: {
            discount: {
              id: getReferralBenefitIds(referrer.dotyposCustomerId).referrer,
              adjustment: { kind: "fixed", amount: currencyCZK(5_000) },
            },
            provenance: {
              providerNamespace: "referral-referrer",
              providerReference: referrer.dotyposCustomerId,
              details: {
                referralReferrer: {
                  referrerDotyposCustomerId: referrer.dotyposCustomerId,
                  eligibleInviteeCount: 1,
                  discountPercentage: "5",
                },
              },
            },
          },
        });
      } finally {
        await deleteBookings([invitee]);
        await testDatabase!.pool.query(
          "delete from referral_attributions where invited_dotypos_customer_id = $1",
          [invitee]
        );
        await referrer.cleanup();
        await loneReferrer.cleanup();
      }
    });

    test("withholds every referral operation while the program is off and leaves recorded referrals untouched", async () => {
      const referrer = await createActiveReferrer();
      const attributedCustomer = uniqueDotyposId();
      const newCustomer = uniqueDotyposId();
      const newAccountId = await insertLinkedAccount(newCustomer);
      const layer = (released: boolean) =>
        makeReferralLayer(
          { accountId: newAccountId, dotyposCustomerId: newCustomer },
          undefined,
          undefined,
          released
        );
      const invitation = (released: boolean) =>
        runReferrals(
          (referrals) =>
            referrals.resolveInvitationCandidate({
              dotyposCustomerId: attributedCustomer,
              locale: "en-US",
            }),
          layer(released)
        );
      try {
        await Effect.runPromise(
          testDatabase!.db.insert(referralAttributions).values({
            invitedDotyposCustomerId: attributedCustomer,
            referrerDotyposCustomerId: referrer.dotyposCustomerId,
            promotionCodeId: referrer.promotionCodeId,
          })
        );
        // Released, the fixture is a live referral with a priced invitation.
        expect(
          await runReferrals(
            (referrals) => referrals.lookupCodeKind({ code: referrer.code }),
            layer(true)
          )
        ).toMatchObject({ _tag: "Success", success: { kind: "referral" } });
        expect(await invitation(true)).toMatchObject({
          _tag: "Success",
          success: { claim: { kind: "referral_invitation" } },
        });

        const withheld = (
          use: Parameters<typeof runReferrals>[0]
        ): ReturnType<typeof runReferrals> => runReferrals(use, layer(false));
        // A withheld program is never reported as an unusable code.
        const disabled = {
          _tag: "Failure",
          failure: { _tag: "ReferralError", reason: "disabled" },
        };
        expect(
          await withheld((referrals) =>
            referrals.lookupCodeKind({ code: referrer.code })
          )
        ).toMatchObject({ _tag: "Success", success: { kind: "other" } });
        expect(
          await withheld((referrals) =>
            referrals.findAvailableCode({ code: referrer.code })
          )
        ).toMatchObject(disabled);
        expect(
          await withheld((referrals) =>
            referrals.evaluateCheckoutReferral({
              code: referrer.code,
              dotyposCustomerId: newCustomer,
            })
          )
        ).toMatchObject(disabled);
        expect(await invitation(false)).toMatchObject({
          _tag: "Success",
          success: undefined,
        });
        expect(
          await withheld((referrals) =>
            referrals.resolveReferrerCandidate({
              dotyposCustomerId: referrer.dotyposCustomerId,
              locale: "en-US",
              remainingSubtotal: currencyCZK(100_000),
            })
          )
        ).toMatchObject({ _tag: "Success", success: undefined });
        expect(
          await withheld((referrals) =>
            referrals.hasSettledReferral({
              dotyposCustomerId: attributedCustomer,
            })
          )
        ).toMatchObject({ _tag: "Success", success: false });
        expect(
          await withheld((referrals) =>
            referrals.getAccountSummary({
              customerAccountId: referrer.accountId,
              dotyposCustomerId: referrer.dotyposCustomerId,
            })
          )
        ).toMatchObject(disabled);
        expect(
          await withheld((referrals) =>
            referrals.acceptReferral({
              code: referrer.code,
              customerAccountId: newAccountId,
              dotyposCustomerId: newCustomer,
            })
          )
        ).toMatchObject(disabled);

        const attributions = await testDatabase!.pool.query(
          "select invited_dotypos_customer_id from referral_attributions where promotion_code_id = $1",
          [referrer.promotionCodeId]
        );
        expect(
          attributions.rows.map((row) => row.invited_dotypos_customer_id)
        ).toEqual([attributedCustomer]);
        const issuedCodes = await testDatabase!.pool.query(
          "select 1 from referral_codes where referrer_dotypos_customer_id = $1",
          [newCustomer]
        );
        expect(issuedCodes.rows).toEqual([]);
      } finally {
        await testDatabase!.pool.query(
          'delete from auth."user" where id = $1',
          [newAccountId]
        );
        await testDatabase!.pool.query(
          "delete from customer_accounts where id = $1",
          [newAccountId]
        );
        await referrer.cleanup();
      }
    });

    test("fails acceptance with the Dotypos outage and rolls back cleanly when history fails inside the attribution transaction", async () => {
      const referrer = await createActiveReferrer();
      const inviteeAccountId = customerAccountIdSchema.make(uniqueId());
      const inviteeCustomerId = uniqueDotyposId();
      await insertAuthUser(inviteeAccountId, {
        linkedCustomer: inviteeCustomerId,
      });
      try {
        const identity = {
          accountId: inviteeAccountId,
          dotyposCustomerId: inviteeCustomerId,
        };
        const failingHistory = makeReferralLayer(
          identity,
          () => [],
          () =>
            Effect.fail(
              new DotyposUnavailable({
                operation: "listReservations",
                reason: "server",
              })
            )
        );

        const acceptance = await runReferrals(
          (referrals) =>
            referrals.acceptReferral({
              code: referrer.code,
              customerAccountId: inviteeAccountId,
              dotyposCustomerId: inviteeCustomerId,
            }),
          failingHistory
        );

        expect(acceptance).toMatchObject({
          _tag: "Failure",
          failure: { _tag: "DotyposUnavailable" },
        });
        // The pool connection is still usable after the rollback.
        const attributions = await testDatabase!.pool.query(
          "select 1 from referral_attributions where invited_dotypos_customer_id = $1",
          [inviteeCustomerId]
        );
        expect(attributions.rows).toEqual([]);
      } finally {
        await testDatabase!.pool.query(
          'delete from auth."user" where id = $1',
          [inviteeAccountId]
        );
        await testDatabase!.pool.query(
          "delete from customer_accounts where id = $1",
          [inviteeAccountId]
        );
        await referrer.cleanup();
      }
    });

    test("dies on an unreadable Dotypos end inside the attribution transaction without writing", async () => {
      const referrer = await createActiveReferrer();
      const inviteeAccountId = customerAccountIdSchema.make(uniqueId());
      const inviteeCustomerId = uniqueDotyposId();
      await insertAuthUser(inviteeAccountId, {
        linkedCustomer: inviteeCustomerId,
      });
      try {
        const identity = {
          accountId: inviteeAccountId,
          dotyposCustomerId: inviteeCustomerId,
        };
        const accept = (history: readonly DotyposReservation[]) =>
          Effect.gen(function* () {
            const referrals = yield* ReferralService;
            return yield* referrals.acceptReferral({
              code: referrer.code,
              customerAccountId: inviteeAccountId,
              dotyposCustomerId: inviteeCustomerId,
            });
          }).pipe(
            Effect.provide(makeReferralLayer(identity, () => history)),
            Effect.runPromiseExit
          );

        for (const endDate of ["not-a-date", "2000-02-30T10:00:00Z"]) {
          const exit = await accept([
            makeLiveConfirmedReservation(
              `unreadable-${uniqueId()}` as DotyposReservationId,
              endDate
            ),
          ]);
          expect(
            Exit.isFailure(exit) &&
              Cause.hasDies(exit.cause) &&
              !Cause.hasFails(exit.cause)
          ).toBe(true);
        }
        const attributions = await testDatabase!.pool.query(
          "select 1 from referral_attributions where invited_dotypos_customer_id = $1",
          [inviteeCustomerId]
        );
        expect(attributions.rows).toEqual([]);

        // The transaction and its locks were released: the customer can
        // still accept once Dotypos lists no booking.
        const readable = await accept([]);
        expect(Exit.isSuccess(readable)).toBe(true);
        const accepted = await testDatabase!.pool.query(
          "select 1 from referral_attributions where invited_dotypos_customer_id = $1",
          [inviteeCustomerId]
        );
        expect(accepted.rows).toHaveLength(1);
      } finally {
        await testDatabase!.pool.query(
          "delete from referral_attributions where invited_dotypos_customer_id = $1",
          [inviteeCustomerId]
        );
        await testDatabase!.pool.query(
          'delete from auth."user" where id = $1',
          [inviteeAccountId]
        );
        await testDatabase!.pool.query(
          "delete from customer_accounts where id = $1",
          [inviteeAccountId]
        );
        await referrer.cleanup();
      }
    });
  }
);

/** A verdict, or the tag of a failure that is not one. */
const outcomeOf = (
  result: Result.Result<
    { readonly kind: string },
    { readonly _tag: string; readonly reason?: unknown }
  >
) => {
  if (Result.isSuccess(result)) return result.success.kind;
  return result.failure._tag === "ReferralError"
    ? result.failure.reason
    : result.failure._tag;
};

type ActiveReferrer = Awaited<ReturnType<typeof createActiveReferrer>>;

type VerdictContext = {
  readonly referrer: ActiveReferrer;
  readonly invitee: {
    readonly accountId: CustomerAccountId;
    readonly dotyposCustomerId: DotyposCustomerId;
  };
};

const readInviteeReferrer = async (invitee: DotyposCustomerId) =>
  (
    await testDatabase!.pool.query<{ referrer_dotypos_customer_id: string }>(
      "select referrer_dotypos_customer_id from referral_attributions where invited_dotypos_customer_id = $1",
      [invitee]
    )
  ).rows[0]?.referrer_dotypos_customer_id;

/** A referrer whose code the invitee holds, with the invitee's linked account. */
const createVerdictContext = async (): Promise<
  VerdictContext & {
    /** Another active referrer, removed with the context. */
    readonly otherReferrer: () => Promise<ActiveReferrer>;
    /** A referral code the invitee owns, removed with the context. */
    readonly inviteeCode: () => Promise<string>;
    readonly cleanup: () => Promise<void>;
  }
> => {
  const referrer = await createActiveReferrer();
  const inviteeCustomerId = uniqueDotyposId();
  const inviteeAccountId = await insertLinkedAccount(inviteeCustomerId);
  const extraReferrers: ActiveReferrer[] = [];
  const inviteePromotionCodeIds: string[] = [];
  return {
    inviteeCode: async () => {
      const [promotion] = await Effect.runPromise(
        testDatabase!.db
          .insert(promotionCodes)
          .values({
            kind: "referral",
            code: canonicalPromotionCodeSchema.make(
              `RFC${uniqueId().replaceAll("-", "").slice(0, 10).toUpperCase()}`
            ),
            enabled: true,
          })
          .returning({ id: promotionCodes.id })
      );
      await Effect.runPromise(
        testDatabase!.db.insert(referralCodes).values({
          promotionCodeId: promotion!.id,
          referrerDotyposCustomerId: inviteeCustomerId,
        })
      );
      inviteePromotionCodeIds.push(promotion!.id);
      return promotion!.id;
    },
    referrer,
    otherReferrer: async () => {
      const other = await createActiveReferrer();
      extraReferrers.push(other);
      return other;
    },
    invitee: {
      accountId: inviteeAccountId,
      dotyposCustomerId: inviteeCustomerId,
    },
    cleanup: async () => {
      await testDatabase!.pool.query(
        "delete from referral_attributions where invited_dotypos_customer_id = any($1)",
        [[inviteeCustomerId, referrer.dotyposCustomerId]]
      );
      await deleteBookings([inviteeCustomerId]);
      await testDatabase!.pool.query('delete from auth."user" where id = $1', [
        inviteeAccountId,
      ]);
      await testDatabase!.pool.query(
        "delete from customer_accounts where id = $1",
        [inviteeAccountId]
      );
      await testDatabase!.pool.query(
        "delete from promotion_codes where id = any($1)",
        [inviteePromotionCodeIds]
      );
      for (const extra of extraReferrers) await extra.cleanup();
      await referrer.cleanup();
    },
  };
};

const evaluateAtCheckout = (
  context: VerdictContext,
  code: string,
  layer = makeReferralLayer(context.invitee)
) =>
  runReferrals(
    (referrals) =>
      referrals.evaluateCheckoutReferral({
        code,
        dotyposCustomerId: context.invitee.dotyposCustomerId,
      }),
    layer
  );

const acceptAtAccount = (
  context: VerdictContext,
  code: string,
  layer = makeReferralLayer(context.invitee)
) =>
  runReferrals(
    (referrals) =>
      referrals.acceptReferral({
        code,
        customerAccountId: context.invitee.accountId,
        dotyposCustomerId: context.invitee.dotyposCustomerId,
      }),
    layer
  );

describe.skipIf(!testDatabase)(
  "ReferralService verdicts at checkout and acceptance on disposable Postgres",
  () => {
    const verdictCases: readonly {
      readonly name: string;
      /** Prepares the case and returns the code the customer enters. */
      readonly arrange: (
        context: Awaited<ReturnType<typeof createVerdictContext>>
      ) => Promise<string>;
      readonly checkout: string;
      readonly acceptance: string;
    }[] = [
      {
        name: "an open first-booking invitation",
        arrange: async ({ referrer }) => referrer.code.toLowerCase(),
        checkout: "eligible",
        acceptance: "accepted",
      },
      {
        name: "an unknown code",
        arrange: async () => "RFX0000000000",
        checkout: "unavailable",
        acceptance: "unavailable",
      },
      {
        name: "a disabled code",
        arrange: async ({ referrer }) => {
          await testDatabase!.pool.query(
            "update promotion_codes set enabled = false where id = $1",
            [referrer.promotionCodeId]
          );
          return referrer.code;
        },
        checkout: "unavailable",
        acceptance: "unavailable",
      },
      {
        name: "an expired code",
        arrange: async ({ referrer }) => {
          await testDatabase!.pool.query(
            "update promotion_codes set valid_until = now() - interval '1 day' where id = $1",
            [referrer.promotionCodeId]
          );
          return referrer.code;
        },
        checkout: "unavailable",
        acceptance: "unavailable",
      },
      {
        name: "a referrer whose account awaits deletion",
        arrange: async ({ referrer }) => {
          await testDatabase!.pool.query(
            'update auth."user" set deletion_requested_at = now() where id = $1',
            [referrer.accountId]
          );
          return referrer.code;
        },
        checkout: "unavailable",
        acceptance: "unavailable",
      },
      {
        name: "an existing referral from the same referrer",
        arrange: async ({ referrer, invitee }) => {
          await Effect.runPromise(
            testDatabase!.db.insert(referralAttributions).values({
              invitedDotyposCustomerId: invitee.dotyposCustomerId,
              referrerDotyposCustomerId: referrer.dotyposCustomerId,
              promotionCodeId: referrer.promotionCodeId,
            })
          );
          // A settled referral needs no open invitation.
          await insertPaidBooking(invitee.dotyposCustomerId);
          return referrer.code;
        },
        checkout: "already_accepted",
        acceptance: "already_accepted",
      },
      {
        name: "an existing referral from another referrer",
        arrange: async ({ referrer, invitee, otherReferrer }) => {
          const other = await otherReferrer();
          await Effect.runPromise(
            testDatabase!.db.insert(referralAttributions).values({
              invitedDotyposCustomerId: invitee.dotyposCustomerId,
              referrerDotyposCustomerId: other.dotyposCustomerId,
              promotionCodeId: other.promotionCodeId,
            })
          );
          return referrer.code;
        },
        checkout: "already_attributed",
        acceptance: "already_attributed",
      },
      {
        name: "a paid first booking",
        arrange: async ({ referrer, invitee }) => {
          await insertPaidBooking(invitee.dotyposCustomerId);
          return referrer.code;
        },
        checkout: "ineligible",
        acceptance: "ineligible",
      },
      {
        name: "a referrer this customer invited",
        arrange: async ({ referrer, invitee, inviteeCode }) => {
          await Effect.runPromise(
            testDatabase!.db.insert(referralAttributions).values({
              invitedDotyposCustomerId: referrer.dotyposCustomerId,
              referrerDotyposCustomerId: invitee.dotyposCustomerId,
              promotionCodeId: await inviteeCode(),
            })
          );
          return referrer.code;
        },
        checkout: "cycle",
        acceptance: "cycle",
      },
    ];

    test.each(verdictCases)(
      "reaches the same verdict for $name at checkout and at acceptance",
      async ({ arrange, checkout, acceptance }) => {
        const context = await createVerdictContext();
        try {
          const code = await arrange(context);
          const before = await readInviteeReferrer(
            context.invitee.dotyposCustomerId
          );

          expect(outcomeOf(await evaluateAtCheckout(context, code))).toBe(
            checkout
          );
          // The checkout check writes nothing.
          expect(
            await readInviteeReferrer(context.invitee.dotyposCustomerId)
          ).toBe(before);

          expect(outcomeOf(await acceptAtAccount(context, code))).toBe(
            acceptance
          );
          expect(
            await readInviteeReferrer(context.invitee.dotyposCustomerId)
          ).toBe(
            acceptance === "accepted"
              ? context.referrer.dotyposCustomerId
              : before
          );
        } finally {
          await context.cleanup();
        }
      }
    );

    test("rejects the customer's own code at checkout and at acceptance", async () => {
      const referrer = await createActiveReferrer();
      try {
        const self: VerdictContext = {
          referrer,
          invitee: {
            accountId: referrer.accountId,
            dotyposCustomerId: referrer.dotyposCustomerId,
          },
        };
        expect(outcomeOf(await evaluateAtCheckout(self, referrer.code))).toBe(
          "self_referral"
        );
        expect(outcomeOf(await acceptAtAccount(self, referrer.code))).toBe(
          "self_referral"
        );
        expect(
          await readInviteeReferrer(referrer.dotyposCustomerId)
        ).toBeUndefined();
      } finally {
        await referrer.cleanup();
      }
    });

    test("lets a checkout carry the referral past its own pending booking while acceptance waits for that payment", async () => {
      const context = await createVerdictContext();
      try {
        await insertPendingBooking(context.invitee.dotyposCustomerId);

        // No invitation claim yet: the pending booking may be this checkout's.
        expect(
          outcomeOf(await evaluateAtCheckout(context, context.referrer.code))
        ).toBe("eligible");
        // Acceptance holds off: that payment may become the first paid booking.
        expect(
          outcomeOf(await acceptAtAccount(context, context.referrer.code))
        ).toBe("pending_payment");
        expect(
          await readInviteeReferrer(context.invitee.dotyposCustomerId)
        ).toBeUndefined();
      } finally {
        await context.cleanup();
      }
    });

    test("reports a Dotypos outage as such, never as a verdict, and decides an existing referral without Dotypos", async () => {
      const context = await createVerdictContext();
      let historyReads = 0;
      const dotyposDown = makeReferralLayer(
        context.invitee,
        () => [],
        () =>
          Effect.suspend(() => {
            historyReads += 1;
            return Effect.fail(
              new DotyposUnavailable({
                operation: "listReservations",
                reason: "timeout",
              })
            );
          })
      );
      try {
        const code = context.referrer.code;
        expect(
          outcomeOf(await evaluateAtCheckout(context, code, dotyposDown))
        ).toBe("DotyposUnavailable");
        expect(
          outcomeOf(await acceptAtAccount(context, code, dotyposDown))
        ).toBe("DotyposUnavailable");
        expect(
          await runReferrals(
            (referrals) =>
              referrals.resolveInvitationCandidate({
                dotyposCustomerId: context.invitee.dotyposCustomerId,
                locale: "en-US",
                referralCode: code,
              }),
            dotyposDown
          )
        ).toMatchObject({
          _tag: "Failure",
          failure: { _tag: "DotyposUnavailable" },
        });
        expect(
          await runReferrals(
            (referrals) =>
              referrals.hasSettledReferral({
                dotyposCustomerId: context.invitee.dotyposCustomerId,
              }),
            dotyposDown
          )
        ).toMatchObject({
          _tag: "Failure",
          failure: { _tag: "DotyposUnavailable" },
        });
        expect(
          await readInviteeReferrer(context.invitee.dotyposCustomerId)
        ).toBeUndefined();
        expect(historyReads).toBe(4);

        // An existing referral settles the verdict before history is read.
        await Effect.runPromise(
          testDatabase!.db.insert(referralAttributions).values({
            invitedDotyposCustomerId: context.invitee.dotyposCustomerId,
            referrerDotyposCustomerId: context.referrer.dotyposCustomerId,
            promotionCodeId: context.referrer.promotionCodeId,
          })
        );
        historyReads = 0;
        expect(
          outcomeOf(await evaluateAtCheckout(context, code, dotyposDown))
        ).toBe("already_accepted");
        expect(
          outcomeOf(await acceptAtAccount(context, code, dotyposDown))
        ).toBe("already_accepted");
        expect(historyReads).toBe(0);
      } finally {
        await context.cleanup();
      }
    });

    test("reports an unreachable referral store as a database failure, never as an unusable code", async () => {
      const context = await createVerdictContext();
      const unreachable = await connectUnreachableWorkspaceDatabase();
      try {
        const databaseLayer = unreachable.database;
        const lockLayer = unreachable.advisoryLock;
        const linksLayer = CustomerAccountLinkRepository.Default.pipe(
          Layer.provide(databaseLayer)
        );
        const authenticationLayer = signedInAuthentication(
          context.invitee.accountId
        );
        const storeDown = ReferralService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              ReferralReleaseGate.fromDecision(true),
              databaseLayer,
              lockLayer,
              linksLayer,
              authenticationLayer,
              CustomerAccountSections.Default.pipe(
                Layer.provide(
                  Layer.mergeAll(authenticationLayer, linksLayer, lockLayer)
                )
              ),
              Layer.mock(DotyposService, {
                listReservations: () => Effect.succeed([]),
              } as Partial<DotyposService["Service"]>)
            )
          )
        );
        const code = context.referrer.code;
        const failures = [
          await runReferrals(
            (referrals) => referrals.findAvailableCode({ code }),
            storeDown
          ),
          await runReferrals(
            (referrals) => referrals.lookupCodeKind({ code }),
            storeDown
          ),
          await evaluateAtCheckout(context, code, storeDown),
          await acceptAtAccount(context, code, storeDown),
        ];

        for (const failure of failures) {
          expect(failure._tag).toBe("Failure");
          expect(
            failure._tag === "Failure" && isDatabaseQueryError(failure.failure)
          ).toBe(true);
        }
        // The code itself is still usable once the store answers again.
        expect(outcomeOf(await evaluateAtCheckout(context, code))).toBe(
          "eligible"
        );
      } finally {
        await unreachable.pool.end();
        await context.cleanup();
      }
    });

    test("leaves acceptance undecided when the referrer relinks while it waits for its locks, and decides on the next attempt", async () => {
      const context = await createVerdictContext();
      const relinkedAccountId = customerAccountIdSchema.make(uniqueId());
      const graph = await holdPostgresTransaction(
        testDatabase!.pool,
        "select pg_advisory_xact_lock(hashtext($1), hashtext($2))",
        ["referral-attribution", "graph"]
      );
      let released = false;
      try {
        const acceptance = acceptAtAccount(context, context.referrer.code);
        await waitForAdvisoryLockWaiter(testDatabase!.pool, [
          "referral-attribution",
          "graph",
        ]);
        // The referrer's customer moves to another account meanwhile.
        await testDatabase!.pool.query(
          "update customer_accounts set dotypos_customer_id = null where id = $1",
          [context.referrer.accountId]
        );
        await insertAuthUser(relinkedAccountId, {
          linkedCustomer: context.referrer.dotyposCustomerId,
        });
        await graph.commit();
        released = true;

        expect(outcomeOf(await acceptance)).toBe("referrer_changed");
        expect(
          await readInviteeReferrer(context.invitee.dotyposCustomerId)
        ).toBeUndefined();

        expect(
          outcomeOf(await acceptAtAccount(context, context.referrer.code))
        ).toBe("accepted");
        expect(
          await readInviteeReferrer(context.invitee.dotyposCustomerId)
        ).toBe(context.referrer.dotyposCustomerId);
      } finally {
        if (!released) await graph.commit();
        await testDatabase!.pool.query(
          'delete from auth."user" where id = $1',
          [relinkedAccountId]
        );
        await testDatabase!.pool.query(
          "delete from customer_accounts where id = $1",
          [relinkedAccountId]
        );
        await context.cleanup();
      }
    });
  }
);

/**
 * The referral service on the disposable database with this session, and with
 * the named account reads failing to connect, so a test fails one account
 * prerequisite at a time while the others answer.
 */
const makeAccountPrerequisiteLayer = (input: {
  readonly authentication: Layer.Layer<CustomerAuthentication>;
  readonly failingAt?: {
    readonly reads: Parameters<typeof accountLinksFailingAt>[0];
    readonly unreachable: CustomerAccountLinkRepository["Service"];
    /** How many times each named read answers before it fails. */
    readonly afterHealthyReads?: number;
  };
  /** The advisory lock the account section takes; the disposable database's by default. */
  readonly sectionLock?: Layer.Layer<WorkspaceDatabaseAdvisoryLock>;
}) => {
  const databaseLayer = Layer.succeed(
    WorkspaceDatabase,
    WorkspaceDatabase.make(testDatabase!.db)
  );
  const lockLayer = WorkspaceDatabaseAdvisoryLock.makeLayer(testDatabase!.pool);
  const healthyLinks = CustomerAccountLinkRepository.Default.pipe(
    Layer.provide(databaseLayer)
  );
  const accountLinks = input.failingAt
    ? accountLinksFailingAt(input.failingAt.reads, {
        healthy: healthyLinks,
        unreachable: input.failingAt.unreachable,
        ...(input.failingAt.afterHealthyReads !== undefined && {
          afterHealthyReads: input.failingAt.afterHealthyReads,
        }),
      })
    : healthyLinks;

  return ReferralService.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        ReferralReleaseGate.fromDecision(true),
        databaseLayer,
        lockLayer,
        accountLinks,
        input.authentication,
        CustomerAccountSections.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              input.authentication,
              accountLinks,
              input.sectionLock ?? lockLayer
            )
          )
        ),
        Layer.mock(DotyposService, {
          listReservations: () => Effect.succeed([]),
        } as Partial<DotyposService["Service"]>)
      )
    )
  );
};

const summarizeAtAccount = (
  context: VerdictContext,
  layer: Layer.Layer<ReferralService>,
  dotyposCustomerId = context.invitee.dotyposCustomerId
) =>
  runReferrals(
    (referrals) =>
      referrals
        .getAccountSummary({
          customerAccountId: context.invitee.accountId,
          dotyposCustomerId,
        })
        .pipe(Effect.as({ kind: "summarized" } as const)),
    layer
  );

describe.skipIf(!testDatabase)(
  "ReferralService account prerequisites on disposable Postgres",
  () => {
    test("reports a session that can't be read as an authentication outage, never as an unavailable account", async () => {
      const context = await createVerdictContext();
      try {
        const sessionDown = makeAccountPrerequisiteLayer({
          authentication: unreachableSessionAuthentication,
        });

        for (const failure of [
          await summarizeAtAccount(context, sessionDown),
          await acceptAtAccount(context, context.referrer.code, sessionDown),
        ]) {
          expect(failure).toMatchObject({
            _tag: "Failure",
            failure: {
              _tag: "ReferralAuthenticationUnavailable",
              diagnostic: "authentication.session.unclassified",
            },
          });
        }
        expect(
          await readInviteeReferrer(context.invitee.dotyposCustomerId)
        ).toBeUndefined();

        expect(
          outcomeOf(await acceptAtAccount(context, context.referrer.code))
        ).toBe("accepted");
      } finally {
        await context.cleanup();
      }
    });

    test.each([
      { read: "find", operations: ["summary", "acceptance"] },
      // The summary reads the account's state only in its section's recheck.
      { read: "findActivityState", operations: ["acceptance"] },
    ] as const)(
      "reports a failed $read as a database outage, never as an unavailable account, and writes nothing",
      async ({ read, operations }) => {
        const context = await createVerdictContext();
        const unreachable = await connectUnreachableWorkspaceDatabase();
        try {
          const readDown = makeAccountPrerequisiteLayer({
            authentication: signedInAuthentication(context.invitee.accountId),
            failingAt: {
              reads: [read],
              unreachable: await unreachableAccountLinks(unreachable),
            },
          });

          for (const operation of operations) {
            const failure =
              operation === "summary"
                ? await summarizeAtAccount(context, readDown)
                : await acceptAtAccount(
                    context,
                    context.referrer.code,
                    readDown
                  );
            expect(failure._tag).toBe("Failure");
            expect(
              failure._tag === "Failure" &&
                isDatabaseQueryError(failure.failure)
            ).toBe(true);
          }
          expect(
            await readInviteeReferrer(context.invitee.dotyposCustomerId)
          ).toBeUndefined();

          // Once the account can be read again, acceptance decides.
          expect(
            outcomeOf(await acceptAtAccount(context, context.referrer.code))
          ).toBe("accepted");
        } finally {
          await unreachable.pool.end();
          await context.cleanup();
        }
      }
    );

    test.each([
      { failing: "lock", code: "account-link.lock" },
      { failing: "recheck", code: "account.deletion-state" },
    ] as const)(
      "reports a summary whose account section fails at its $failing as an account check outage, never as an unavailable account",
      async ({ failing, code }) => {
        const context = await createVerdictContext();
        const unreachable = await connectUnreachableWorkspaceDatabase();
        try {
          // The summary reads the account's state only in the section's
          // recheck, under the lock.
          const sectionDown = makeAccountPrerequisiteLayer({
            authentication: signedInAuthentication(context.invitee.accountId),
            ...(failing === "lock"
              ? { sectionLock: unreachable.advisoryLock }
              : {
                  failingAt: {
                    reads: ["findActivityState"],
                    unreachable: await unreachableAccountLinks(unreachable),
                  },
                }),
          });

          expect(await summarizeAtAccount(context, sectionDown)).toMatchObject({
            _tag: "Failure",
            failure: { _tag: "ReferralAccountCheckUnavailable", code },
          });
          expect(
            (
              await summarizeAtAccount(
                context,
                makeAccountPrerequisiteLayer({
                  authentication: signedInAuthentication(
                    context.invitee.accountId
                  ),
                })
              )
            )._tag
          ).toBe("Success");
        } finally {
          await unreachable.pool.end();
          await context.cleanup();
        }
      }
    );

    test("reports a failed link recheck under acceptance's locks as a database outage and writes nothing", async () => {
      const context = await createVerdictContext();
      const unreachable = await connectUnreachableWorkspaceDatabase();
      try {
        // The identity check reads the link before the locks; the recheck
        // inside the attribution transaction fails.
        const recheckDown = makeAccountPrerequisiteLayer({
          authentication: signedInAuthentication(context.invitee.accountId),
          failingAt: {
            reads: ["find"],
            unreachable: await unreachableAccountLinks(unreachable),
            afterHealthyReads: 1,
          },
        });

        const failure = await acceptAtAccount(
          context,
          context.referrer.code,
          recheckDown
        );
        expect(failure._tag).toBe("Failure");
        expect(
          failure._tag === "Failure" && isDatabaseQueryError(failure.failure)
        ).toBe(true);
        expect(
          await readInviteeReferrer(context.invitee.dotyposCustomerId)
        ).toBeUndefined();

        expect(
          outcomeOf(await acceptAtAccount(context, context.referrer.code))
        ).toBe("accepted");
      } finally {
        await unreachable.pool.end();
        await context.cleanup();
      }
    });

    test("still reports a gone, other, deleting, or relinked account as account_unavailable", async () => {
      const context = await createVerdictContext();
      try {
        const otherSession = makeAccountPrerequisiteLayer({
          authentication: signedInAuthentication(context.referrer.accountId),
        });
        const deletingSession = makeAccountPrerequisiteLayer({
          authentication: signedInAuthentication(context.invitee.accountId, {
            deletionRequested: true,
          }),
        });
        const noSession = makeAccountPrerequisiteLayer({
          authentication: Layer.succeed(CustomerAuthentication, {
            currentUser: Effect.succeed(null),
          }),
        });
        const ownSession = makeAccountPrerequisiteLayer({
          authentication: signedInAuthentication(context.invitee.accountId),
        });

        for (const layer of [otherSession, deletingSession, noSession]) {
          expect(outcomeOf(await summarizeAtAccount(context, layer))).toBe(
            "account_unavailable"
          );
          expect(
            outcomeOf(
              await acceptAtAccount(context, context.referrer.code, layer)
            )
          ).toBe("account_unavailable");
        }

        // The account is linked to another customer than the caller named.
        expect(
          outcomeOf(
            await summarizeAtAccount(context, ownSession, uniqueDotyposId())
          )
        ).toBe("account_unavailable");

        // The account awaits deletion: the summary checks it under the
        // account lock, acceptance under its transaction's locks.
        await testDatabase!.pool.query(
          `update auth."user" set deletion_requested_at = now() where id = $1`,
          [context.invitee.accountId]
        );
        expect(outcomeOf(await summarizeAtAccount(context, ownSession))).toBe(
          "account_unavailable"
        );
        expect(
          outcomeOf(
            await acceptAtAccount(context, context.referrer.code, ownSession)
          )
        ).toBe("account_unavailable");
        await testDatabase!.pool.query(
          `update auth."user" set deletion_requested_at = null where id = $1`,
          [context.invitee.accountId]
        );

        expect(
          await readInviteeReferrer(context.invitee.dotyposCustomerId)
        ).toBeUndefined();
        expect(
          outcomeOf(
            await acceptAtAccount(context, context.referrer.code, ownSession)
          )
        ).toBe("accepted");
      } finally {
        await context.cleanup();
      }
    });
  }
);
