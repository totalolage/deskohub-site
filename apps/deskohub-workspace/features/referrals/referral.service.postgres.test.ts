import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import {
  type DotyposCustomerId,
  type DotyposReservation,
  type DotyposReservationId,
  DotyposService,
} from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { WorkspaceDatabaseAdvisoryLock } from "@/db/postgres-advisory-lock";
import {
  promotionCodes,
  referralAttributions,
  referralCodes,
  workspaceReservations,
} from "@/db/schema";
import { CustomerAccountLinkRepository } from "@/features/account/backend/customer-account-link.repository";
import { CustomerAccountResolver } from "@/features/account/backend/customer-account-resolver.service";
import {
  type CustomerAccountId,
  customerAccountIdSchema,
} from "@/features/account/customer-account";
import { checkoutAttemptKeySchema } from "@/features/checkout/checkout-identifiers";
import { canonicalPromotionCodeSchema } from "@/features/discounts/persistence-contracts";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { ReferralService } from "./referral.service";

const testDatabase = await connectWorkspacePostgresTestDatabase();
const uniqueId = () => crypto.randomUUID();
const uniqueDotyposId = () =>
  `${Math.floor(Math.random() * 900_000) + 100_000}${Math.floor(
    Math.random() * 900
  )}` as DotyposCustomerId;

const insertAuthUser = async (accountId: CustomerAccountId) => {
  await testDatabase!.pool.query(
    `insert into auth."user" (id, name, email) values ($1, '', $2)`,
    [accountId, `${accountId}@deskohub.test`]
  );
};

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
  reservations: readonly DotyposReservation[] = []
) => {
  const databaseLayer = Layer.succeed(
    WorkspaceDatabase,
    WorkspaceDatabase.of({ db: testDatabase!.db })
  );
  const lockLayer = WorkspaceDatabaseAdvisoryLock.makeLayer(testDatabase!.pool);
  const accountLinksLayer = CustomerAccountLinkRepository.Default.pipe(
    Layer.provide(Layer.mergeAll(databaseLayer, lockLayer))
  );

  return ReferralService.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        databaseLayer,
        lockLayer,
        accountLinksLayer,
        Layer.succeed(CustomerAccountResolver, {
          resolve: Effect.succeed(identity),
        }),
        Layer.mock(DotyposService, {
          listReservations: () => Effect.succeed(reservations),
        } as Partial<DotyposService["Service"]>)
      )
    )
  );
};

describe.skipIf(!testDatabase)("ReferralService on disposable Postgres", () => {
  test("requires an active referrer even for an existing same-referrer attribution after a paid booking", async () => {
    const inviteeAccountId = customerAccountIdSchema.make(uniqueId());
    const ownerAccountId = customerAccountIdSchema.make(uniqueId());
    const inviteeCustomerId = uniqueDotyposId();
    const ownerCustomerId = uniqueDotyposId();
    const code = "RFL12345";
    let promotionCodeId: string | undefined;

    await insertAuthUser(inviteeAccountId);
    await insertAuthUser(ownerAccountId);
    await testDatabase!.pool.query(
      `insert into customer_account_links (customer_account_id, dotypos_customer_id) values ($1, $2), ($3, $4)`,
      [inviteeAccountId, inviteeCustomerId, ownerAccountId, ownerCustomerId]
    );

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
      await Effect.runPromise(
        testDatabase!.db.insert(workspaceReservations).values({
          checkoutAttemptKey: checkoutAttemptKeySchema.make(
            `referral-${uniqueId()}`
          ),
          dotyposCustomerId: inviteeCustomerId,
          dotyposReservationId:
            `reservation-${uniqueId()}` as DotyposReservationId,
          reservationState: "confirmed",
          paymentState: "paid",
          paidAt: Temporal.Now.instant(),
          fulfillmentState: "not_started",
          reservationDetails: {
            kind: "cowork",
            entryTier: "basic",
            coffee: false,
          },
          locale: "en-US",
        })
      );

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
        `delete from customer_account_links where customer_account_id = any($1)`,
        [[inviteeAccountId, ownerAccountId]]
      );
      await testDatabase!.pool.query(
        `delete from auth."user" where id = any($1)`,
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
      "RFL" + uniqueId().replaceAll("-", "").slice(0, 12).toUpperCase()
    );
    const codeB = canonicalPromotionCodeSchema.make(
      "RFL" + uniqueId().replaceAll("-", "").slice(0, 12).toUpperCase()
    );
    let promotionA: string | undefined;
    let promotionB: string | undefined;

    await insertAuthUser(accountA);
    await insertAuthUser(accountB);
    await testDatabase!.pool.query(
      "insert into customer_account_links (customer_account_id, dotypos_customer_id) values ($1, $2), ($3, $4)",
      [accountA, customerA, accountB, customerB]
    );

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
        "delete from customer_account_links where customer_account_id = any($1)",
        [[accountA, accountB]]
      );
      await testDatabase!.pool.query(
        'delete from auth."user" where id = any($1)',
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
      code: "RFL" + uniqueId().replaceAll("-", "").slice(0, 12).toUpperCase(),
    });
    const unknownReferral = await insertReferralFixture({
      inviteeCustomerId: unknownCustomer,
      ownerCustomerId: unknownOwner,
      code: "RFL" + uniqueId().replaceAll("-", "").slice(0, 12).toUpperCase(),
    });
    await Effect.runPromise(
      testDatabase!.db.insert(workspaceReservations).values({
        checkoutAttemptKey: checkoutAttemptKeySchema.make(
          "referral-unpaid-" + uniqueId()
        ),
        dotyposCustomerId: unpaidCustomer,
        dotyposReservationId: unpaidReservationId,
        reservationState: "held",
        paymentState: "failed",
        fulfillmentState: "not_started",
        reservationDetails: {
          kind: "cowork",
          entryTier: "basic",
          coffee: false,
        },
        locale: "en-US",
        reservationHoldExpiresAt: Temporal.Now.instant().add({ hours: 1 }),
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
              [makeLiveConfirmedReservation(unpaidReservationId)]
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
              [
                makeLiveConfirmedReservation(
                  ("untracked-" + uniqueId()) as DotyposReservationId
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
    const paidReservationId = ("paid-" + uniqueId()) as DotyposReservationId;
    const referral = await insertReferralFixture({
      inviteeCustomerId,
      ownerCustomerId,
      code: "RFL" + uniqueId().replaceAll("-", "").slice(0, 12).toUpperCase(),
    });
    await insertAuthUser(oldAccountId);
    await insertAuthUser(newAccountId);
    await insertAuthUser(ownerAccountId);
    await testDatabase!.pool.query(
      "insert into customer_account_links (customer_account_id, dotypos_customer_id) values ($1, $2), ($3, $4)",
      [oldAccountId, inviteeCustomerId, ownerAccountId, ownerCustomerId]
    );
    await Effect.runPromise(
      testDatabase!.db.insert(workspaceReservations).values({
        checkoutAttemptKey: checkoutAttemptKeySchema.make(
          "referral-paid-" + uniqueId()
        ),
        dotyposCustomerId: inviteeCustomerId,
        dotyposReservationId: paidReservationId,
        reservationState: "confirmed",
        paymentState: "paid",
        paidAt: Temporal.Now.instant(),
        fulfillmentState: "not_started",
        reservationDetails: {
          kind: "cowork",
          entryTier: "basic",
          coffee: false,
        },
        locale: "en-US",
      })
    );

    try {
      await testDatabase!.pool.query('delete from auth."user" where id = $1', [
        oldAccountId,
      ]);
      await testDatabase!.pool.query(
        "insert into customer_account_links (customer_account_id, dotypos_customer_id) values ($1, $2)",
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
        "select customer_account_id from customer_account_links where dotypos_customer_id = $1",
        [inviteeCustomerId]
      );

      expect(link.rows).toEqual([{ customer_account_id: newAccountId }]);
      expect(candidate).toBeUndefined();
    } finally {
      await testDatabase!.pool.query(
        "delete from workspace_reservations where dotypos_customer_id = $1",
        [inviteeCustomerId]
      );
      await referral.cleanup();
      await testDatabase!.pool.query(
        "delete from customer_account_links where customer_account_id = any($1)",
        [[newAccountId, ownerAccountId]]
      );
      await testDatabase!.pool.query(
        'delete from auth."user" where id = any($1)',
        [[newAccountId, ownerAccountId]]
      );
    }
  });
});
