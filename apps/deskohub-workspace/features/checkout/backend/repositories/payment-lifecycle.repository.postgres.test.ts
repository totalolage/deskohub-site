import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import {
  type DotyposCustomerId,
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
  DotyposService,
} from "@deskohub/dotypos";
import { NexiOrderIdSchema } from "@deskohub/nexi";
import { PostHogFeatureFlagEvaluationError } from "@deskohub/posthog/feature-flags/node";
import { testEmailAddress } from "@deskohub/test-email";
import { eq, sql } from "drizzle-orm";
import { Cause, Effect, Exit, Layer, Predicate, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { makeDatabaseClient, makeDatabasePool } from "@/db/database-client";
import { databasePoolTimeouts } from "@/db/database-pool-timeouts";
import { WorkspaceDatabaseAdvisoryLock } from "@/db/postgres-advisory-lock";
import {
  accountingDocumentSnapshots,
  discountApplications,
  discountCodes,
  discountProductTargets,
  discounts,
  paymentAttempts,
  promotionCodes,
  referralAttributions,
  referralCodes,
  vouchers,
  workspaceReservations,
} from "@/db/schema";
import { WorkspaceLockSections } from "@/db/workspace-locks";
import { CustomerAccountLinkRepository } from "@/features/account/backend/customer-account-link.repository";
import { CustomerAccountResolver } from "@/features/account/backend/customer-account-resolver.service";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import {
  type AccountingDocumentSnapshot,
  accountingDocumentSnapshotSchema,
  makeAccountingDocumentSnapshot,
} from "@/features/accounting/accounting-document-snapshot";
import { makeCoworkInvoiceDocument } from "@/features/accounting/invoice.test-utils";
import type { PreparedCustomerQuote } from "@/features/checkout/backend/checkout/checkout-pricing.service";
import { LatePaymentRecoveryRepository } from "@/features/checkout/backend/repositories/late-payment-recovery.repository";
import {
  type IPaymentLifecycleRepository,
  PaymentLifecycleRepository,
} from "@/features/checkout/backend/repositories/payment-lifecycle.repository";
import { buildCoworkReservationQuote } from "@/features/checkout/reservation-quote-cowork";
import { calculateDiscounts } from "@/features/discounts/calculator";
import {
  type DiscountCommitment,
  getDiscountCommitmentPayload,
  makeDiscountCommitment,
} from "@/features/discounts/commitment";
import {
  type DiscountQuote,
  discountIdSchema,
} from "@/features/discounts/contracts";
import { deriveOpaqueDiscountId } from "@/features/discounts/opaque-discount-id";
import {
  canonicalPromotionCodeSchema,
  discountCodeIdSchema,
  promotionCodeIdSchema,
  type StoredDiscountId,
  storedDiscountIdSchema,
  voucherIdSchema,
} from "@/features/discounts/persistence-contracts";
import {
  getWorkspaceProductTargetsCovering,
  type WorkspaceProductTarget,
} from "@/features/discounts/product-target";
import type { DiscountCandidate } from "@/features/discounts/provider";
import { WorkspaceFeatureFlagServiceMock } from "@/features/feature-flags/backend/workspace-feature-flag.service.mock";
import { type Locale, m } from "@/features/i18n";
import { getReferralInvitationDiscountId } from "@/features/referrals/discount-identifiers";
import { ReferralService } from "@/features/referrals/referral.service";
import { ReferralFeatureFlagService } from "@/features/referrals/referral-feature-flag.service";
import { ReferralFeatureFlagServiceMock } from "@/features/referrals/referral-feature-flag.service.mock";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import type { Money } from "@/shared/money/money";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import {
  waitForAdvisoryLockWaiter,
  waitForPostgresLockWaiter,
} from "@/shared/testing/workspace-postgres-lock-waiters.test-utils";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";

const testDatabase = await connectWorkspacePostgresTestDatabase();
const product = { kind: "cowork", tier: "basic" } as const;
const uniqueId = () => crypto.randomUUID();
const customerId = () =>
  (
    Math.floor(Math.random() * 900_000_000) + 100_000_000
  ).toString() as DotyposCustomerId;

type Reservation = typeof workspaceReservations.$inferSelect;
type Admission = {
  readonly amount: Money;
  readonly commitment: DiscountCommitment;
};

const referralFeatureFlag = (enabled: boolean) =>
  ReferralFeatureFlagServiceMock({ isEnabled: Effect.succeed(enabled) });

/**
 * The referral flag as a paid transition's run would see it: off, or failing
 * to evaluate (which the flag service reports as off).
 */
const withheldReferralFlags = [
  ["off", referralFeatureFlag(false)],
  [
    "unreadable",
    ReferralFeatureFlagService.Default.pipe(
      Layer.provide(
        WorkspaceFeatureFlagServiceMock({
          isEnabled: () =>
            Effect.fail(
              new PostHogFeatureFlagEvaluationError({
                message: "synthetic flag outage",
                cause: undefined,
              })
            ),
        })
      )
    ),
  ],
] as const;

const makeRepository = async (
  databaseLayer = testDatabase!.layer
): Promise<IPaymentLifecycleRepository> =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* PaymentLifecycleRepository;
    }).pipe(
      Effect.provide(
        PaymentLifecycleRepository.Default.pipe(Layer.provide(databaseLayer))
      )
    )
  );

/** Runs `effect` inside an account's lock section, as checkout's account guard does. */
const inAccountGuard = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  WorkspaceLockSections.customerAccount(
    customerAccountIdSchema.make(`account-${uniqueId()}`)
  )(effect).pipe(
    Effect.provide(WorkspaceDatabaseAdvisoryLock.makeLayer(testDatabase!.pool))
  );

const makeReferralService = async (input?: {
  readonly databaseLayer?: Layer.Layer<WorkspaceDatabase>;
  readonly pool?: ReturnType<typeof makeDatabasePool>;
  readonly identity?: {
    readonly accountId: ReturnType<typeof customerAccountIdSchema.make>;
    readonly dotyposCustomerId: DotyposCustomerId;
  };
  readonly listReservations?: () => Effect.Effect<readonly never[]>;
}) => {
  const databaseLayer = input?.databaseLayer ?? testDatabase!.layer;
  const lockLayer = WorkspaceDatabaseAdvisoryLock.makeLayer(
    input?.pool ?? testDatabase!.pool
  );
  const accountLinksLayer = CustomerAccountLinkRepository.Default.pipe(
    Layer.provide(Layer.mergeAll(databaseLayer, lockLayer))
  );

  return Effect.runPromise(
    Effect.gen(function* () {
      return yield* ReferralService;
    }).pipe(
      Effect.provide(
        ReferralService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              referralFeatureFlag(true),
              databaseLayer,
              lockLayer,
              accountLinksLayer,
              Layer.mock(CustomerAccountResolver, {
                resolve: input?.identity
                  ? Effect.succeed(input.identity)
                  : Effect.die("Identity is not used by quote lookup"),
              }),
              Layer.mock(DotyposService, {
                listReservations:
                  input?.listReservations ?? (() => Effect.succeed([])),
              } as Partial<DotyposService["Service"]>)
            )
          )
        )
      )
    )
  );
};

const makeLateRecoveryRepository = async () =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* LatePaymentRecoveryRepository;
    }).pipe(
      Effect.provide(
        LatePaymentRecoveryRepository.Default.pipe(
          Layer.provide(testDatabase!.layer)
        )
      )
    )
  );

const createInvitedCustomer = async (withAttribution = true) => {
  const invitedDotyposCustomerId = customerId();
  const referrerDotyposCustomerId = customerId();
  const code = canonicalPromotionCodeSchema.make(
    `RFL${crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`
  );
  const [promotion] = await Effect.runPromise(
    testDatabase!.db
      .insert(promotionCodes)
      .values({ kind: "referral", code, enabled: true })
      .returning({ id: promotionCodes.id })
  );
  await Effect.runPromise(
    testDatabase!.db.insert(referralCodes).values({
      promotionCodeId: promotion!.id,
      referrerDotyposCustomerId,
    })
  );
  const acceptAttribution = () =>
    Effect.runPromise(
      testDatabase!.db.insert(referralAttributions).values({
        invitedDotyposCustomerId,
        referrerDotyposCustomerId,
        promotionCodeId: promotion!.id,
      })
    );
  if (withAttribution) await acceptAttribution();

  const cleanup = async () => {
    await testDatabase!.pool.query(
      "delete from referral_invitation_claims where invited_dotypos_customer_id = $1",
      [invitedDotyposCustomerId]
    );
    await testDatabase!.pool.query(
      "delete from discount_code_redemptions where dotypos_customer_id = $1",
      [invitedDotyposCustomerId]
    );
    await testDatabase!.pool.query(
      "delete from voucher_redemptions where dotypos_customer_id = $1",
      [invitedDotyposCustomerId]
    );
    await testDatabase!.pool.query(
      "update payment_attempts set state = 'failed', refund_state = 'not_required', failure_code = 'referral_test_cleanup' where provider <> 'internal' and workspace_reservation_id in (select id from workspace_reservations where dotypos_customer_id = $1)",
      [invitedDotyposCustomerId]
    );
    await testDatabase!.pool.query(
      "delete from accounting_document_snapshots where workspace_reservation_id in (select id from workspace_reservations where dotypos_customer_id = $1) and payment_attempt_id in (select id from payment_attempts where provider <> 'internal')",
      [invitedDotyposCustomerId]
    );
    await testDatabase!.pool.query(
      "delete from late_payment_recoveries where workspace_reservation_id in (select id from workspace_reservations where dotypos_customer_id = $1)",
      [invitedDotyposCustomerId]
    );
    await testDatabase!.pool.query(
      "delete from discount_applications where workspace_reservation_id in (select id from workspace_reservations where dotypos_customer_id = $1)",
      [invitedDotyposCustomerId]
    );
    await testDatabase!.pool.query(
      "delete from payment_attempts where provider <> 'internal' and workspace_reservation_id in (select id from workspace_reservations where dotypos_customer_id = $1)",
      [invitedDotyposCustomerId]
    );
    await testDatabase!.pool.query(
      "delete from workspace_reservations reservation where dotypos_customer_id = $1 and not exists (select 1 from payment_attempts where workspace_reservation_id = reservation.id and provider = 'internal')",
      [invitedDotyposCustomerId]
    );
    await testDatabase!.pool.query(
      "delete from referral_attributions where invited_dotypos_customer_id = $1",
      [invitedDotyposCustomerId]
    );
    await testDatabase!.pool.query(
      "delete from referral_codes where promotion_code_id = $1",
      [promotion!.id]
    );
    await testDatabase!.pool.query(
      "delete from promotion_codes where id = $1",
      [promotion!.id]
    );
  };

  return {
    invitedDotyposCustomerId,
    referrerDotyposCustomerId,
    promotionCodeId: promotion!.id,
    code,
    acceptAttribution,
    cleanup,
  };
};

const createHeldReservation = (
  dotyposCustomerId: DotyposCustomerId
): Promise<Reservation> =>
  Effect.runPromise(
    workspaceFixtures(testDatabase!.db).reservation({
      stage: { reservation: "held" },
      customer: dotyposCustomerId,
    })
  );

const createOrdinaryDiscountCode = async (
  dotyposCustomerId: DotyposCustomerId
) => {
  const code = canonicalPromotionCodeSchema.make(
    `D${uniqueId().replaceAll("-", "").slice(0, 12).toUpperCase()}`
  );
  const labels = {
    "en-US": "Stored campaign",
    "cs-CZ": "Uložená kampaň",
  };
  const [promotion] = await Effect.runPromise(
    testDatabase!.db
      .insert(promotionCodes)
      .values({ kind: "discount", code, enabled: true })
      .returning({ id: promotionCodes.id })
  );
  const [storedDiscount] = await Effect.runPromise(
    testDatabase!.db
      .insert(discounts)
      .values({ labels, percentageBasisPoints: 1_000 })
      .returning({ id: discounts.id })
  );
  await Effect.runPromise(
    testDatabase!.db.insert(discountProductTargets).values({
      discountId: storedDiscount!.id,
      // The family target, which covers every cowork tier.
      productTarget: getWorkspaceProductTargetsCovering(product)[0],
    })
  );
  const [codeRow] = await Effect.runPromise(
    testDatabase!.db
      .insert(discountCodes)
      .values({
        code,
        enabled: true,
        promotionCodeId: promotion!.id,
        discountId: storedDiscount!.id,
        maxUses: 5,
        maxUsesPerCustomer: 1,
      })
      .returning({ id: discountCodes.id })
  );

  const candidate: DiscountCandidate = {
    discount: {
      id: storedDiscount!.id,
      label: labels["en-US"],
      adjustment: { kind: "percentage", basisPoints: 1_000 },
    },
    provenance: {
      providerNamespace: "database-discount-code",
      providerReference: codeRow!.id,
      details: {
        discountCodeId: codeRow!.id,
        storedDiscountId: storedDiscount!.id,
      },
    },
    claim: {
      kind: "discount_code",
      codeId: codeRow!.id,
      storedDiscountId: storedDiscount!.id,
      dotyposCustomerId,
      product,
    },
  };

  return {
    candidate,
    cleanup: async () => {
      await testDatabase!.pool.query(
        "delete from promotion_codes where id = $1",
        [promotion!.id]
      );
      await testDatabase!.pool.query(
        "delete from discount_product_targets where discount_id = $1",
        [storedDiscount!.id]
      );
      await testDatabase!.pool.query("delete from discounts where id = $1", [
        storedDiscount!.id,
      ]);
    },
  };
};

const createVoucher = async (
  dotyposCustomerId: DotyposCustomerId,
  amount = 2_000
) => {
  const code = canonicalPromotionCodeSchema.make(
    `V${uniqueId().replaceAll("-", "").slice(0, 12).toUpperCase()}`
  );
  const [promotion] = await Effect.runPromise(
    testDatabase!.db
      .insert(promotionCodes)
      .values({ kind: "voucher", code, enabled: true })
      .returning({ id: promotionCodes.id })
  );
  const [voucher] = await Effect.runPromise(
    testDatabase!.db
      .insert(vouchers)
      .values({
        promotionCodeId: promotion!.id,
        issuedAmountValue: amount,
        issuedAmountExponent: 2,
        issuedAmountCurrency: "CZK",
      })
      .returning({ id: vouchers.id })
  );
  const availableAmount = { value: amount, exponent: 2, currency: "CZK" };
  const candidate: DiscountCandidate = {
    discount: {
      id: deriveOpaqueDiscountId({
        providerNamespace: "database-voucher",
        providerReference: voucher!.id,
      }),
      label: m.checkoutVoucherLabel({}, { locale: "en-US" }),
      adjustment: { kind: "fixed", amount: availableAmount },
    },
    provenance: {
      providerNamespace: "database-voucher",
      providerReference: voucher!.id,
      details: { voucherId: voucher!.id },
    },
    claim: {
      kind: "voucher",
      voucherId: voucher!.id,
      availableAmount,
      dotyposCustomerId,
    },
  };

  return {
    candidate,
    cleanup: async () => {
      await testDatabase!.pool.query(
        "delete from promotion_codes where id = $1",
        [promotion!.id]
      );
    },
  };
};

const makeSnapshot = (
  reservation: Reservation,
  dotyposCustomerId: DotyposCustomerId,
  discountQuote?: DiscountQuote
) => {
  const prepared = {
    kind: "cowork" as const,
    reservation: {
      kind: "cowork" as const,
      entryTier: "basic" as const,
      coffee: false,
      date: "2099-01-01",
      name: "Synthetic Customer",
      email: testEmailAddress("synthetic"),
      phone: "+420 700 000 000",
    },
    quote: Effect.runSync(
      buildCoworkReservationQuote(
        { kind: "cowork", entryTier: "basic", coffee: false },
        discountQuote ? { discountQuote } : {}
      )
    ),
  } as PreparedCustomerQuote;

  return makeAccountingDocumentSnapshot({
    workspaceReservationId: reservation.id,
    dotyposReservationId: reservation.dotyposReservationId!,
    dotyposCustomerId,
    locale: "en-US",
    prepared,
  });
};

const makeReferralAdmission = (input: {
  readonly reservation: Reservation;
  readonly invitedDotyposCustomerId: DotyposCustomerId;
  readonly referrerDotyposCustomerId: DotyposCustomerId;
  readonly promotionCodeId: string;
  readonly ordinaryCandidates?: readonly DiscountCandidate[];
  readonly creditCandidates?: readonly DiscountCandidate[];
}) => {
  const baseQuote = Effect.runSync(
    buildCoworkReservationQuote({
      kind: "cowork",
      entryTier: "basic",
      coffee: false,
    })
  );
  const locale: Locale = "en-US";
  const promotionCodeId = promotionCodeIdSchema.make(input.promotionCodeId);
  const candidate = {
    discount: {
      id: getReferralInvitationDiscountId(input.invitedDotyposCustomerId),
      label: m.checkoutSummaryItemReferralInvitationDiscount({}, { locale }),
      adjustment: { kind: "percentage" as const, basisPoints: 1_500 },
    },
    provenance: {
      providerNamespace: "referral-invitation",
      providerReference: input.promotionCodeId,
      details: {
        referralInvitation: {
          invitedDotyposCustomerId: input.invitedDotyposCustomerId,
          referrerDotyposCustomerId: input.referrerDotyposCustomerId,
          promotionCodeId,
        },
      },
    },
    claim: {
      kind: "referral_invitation" as const,
      invitedDotyposCustomerId: input.invitedDotyposCustomerId,
      referrerDotyposCustomerId: input.referrerDotyposCustomerId,
      promotionCodeId,
    },
  };
  const calculation = Effect.runSync(
    calculateDiscounts({
      product,
      discountableSubtotal: baseQuote.payment.expectedPrice,
      candidates: [...(input.ordinaryCandidates ?? []), candidate],
    })
  );
  const creditCalculation = input.creditCandidates?.length
    ? Effect.runSync(
        calculateDiscounts({
          product,
          discountableSubtotal: calculation.quote.discountedSubtotal,
          candidates: input.creditCandidates,
        })
      )
    : undefined;
  const discountQuote = creditCalculation
    ? {
        ...calculation.quote,
        discounts: [
          ...calculation.quote.discounts,
          ...creditCalculation.quote.discounts,
        ],
        totalDiscount: {
          ...baseQuote.payment.expectedPrice,
          value:
            baseQuote.payment.expectedPrice.value -
            creditCalculation.quote.discountedSubtotal.value,
        },
        discountedSubtotal: creditCalculation.quote.discountedSubtotal,
      }
    : calculation.quote;
  const snapshot = makeSnapshot(
    input.reservation,
    input.invitedDotyposCustomerId,
    discountQuote
  );

  return {
    locale,
    snapshot,
    admission: {
      amount: snapshot.quote.payment.expectedPrice,
      commitment: makeDiscountCommitment({
        product,
        applications: [
          ...calculation.applications,
          ...(creditCalculation?.applications ?? []),
        ],
      }),
    } satisfies Admission,
  };
};

const makeOrdinaryAdmission = (
  reservation: Reservation,
  dotyposCustomerId: DotyposCustomerId
) => {
  const snapshot = makeSnapshot(reservation, dotyposCustomerId);
  return {
    locale: "en-US" as const,
    snapshot,
    admission: {
      amount: snapshot.quote.payment.expectedPrice,
      commitment: makeDiscountCommitment({ product, applications: [] }),
    } satisfies Admission,
  };
};

const admit = (
  repository: IPaymentLifecycleRepository,
  reservation: Reservation,
  input: ReturnType<typeof makeOrdinaryAdmission>
) =>
  repository.createPendingNexiAttempt({
    workspaceReservationId: reservation.id,
    providerOrderId: `order-${uniqueId()}` as never,
    amount: input.admission.amount,
    commitment: input.admission.commitment,
    locale: input.locale,
    accountingSnapshot: input.snapshot,
  });

describe.skipIf(!testDatabase)(
  "PaymentLifecycleRepository first-use admission on disposable Postgres",
  () => {
    test("serializes an ordinary first attempt and a referral attempt in either order", async () => {
      const repository = await makeRepository();

      for (const order of ["ordinary-first", "referral-first"] as const) {
        const fixture = await createInvitedCustomer();
        try {
          const ordinaryReservation = await createHeldReservation(
            fixture.invitedDotyposCustomerId
          );
          const referralReservation = await createHeldReservation(
            fixture.invitedDotyposCustomerId
          );
          const ordinary = makeOrdinaryAdmission(
            ordinaryReservation,
            fixture.invitedDotyposCustomerId
          );
          const referral = makeReferralAdmission({
            reservation: referralReservation,
            invitedDotyposCustomerId: fixture.invitedDotyposCustomerId,
            referrerDotyposCustomerId: fixture.referrerDotyposCustomerId,
            promotionCodeId: fixture.promotionCodeId,
          });
          const first = await Effect.runPromise(
            order === "ordinary-first"
              ? admit(repository, ordinaryReservation, ordinary)
              : admit(repository, referralReservation, referral)
          );
          expect(first.state).toBe("created");

          const second = await Effect.runPromise(
            Effect.result(
              order === "ordinary-first"
                ? admit(repository, referralReservation, referral)
                : admit(repository, ordinaryReservation, ordinary)
            )
          );
          expect(second._tag).toBe("Failure");
        } finally {
          await fixture.cleanup();
        }
      }
    });

    test("admits exactly one competing first-use payment under concurrent calls", async () => {
      const repository = await makeRepository();
      const fixture = await createInvitedCustomer();
      try {
        const ordinaryReservation = await createHeldReservation(
          fixture.invitedDotyposCustomerId
        );
        const referralReservation = await createHeldReservation(
          fixture.invitedDotyposCustomerId
        );
        const ordinary = makeOrdinaryAdmission(
          ordinaryReservation,
          fixture.invitedDotyposCustomerId
        );
        const referral = makeReferralAdmission({
          reservation: referralReservation,
          invitedDotyposCustomerId: fixture.invitedDotyposCustomerId,
          referrerDotyposCustomerId: fixture.referrerDotyposCustomerId,
          promotionCodeId: fixture.promotionCodeId,
        });
        const outcomes = await Promise.all([
          Effect.runPromise(
            Effect.result(admit(repository, ordinaryReservation, ordinary))
          ),
          Effect.runPromise(
            Effect.result(admit(repository, referralReservation, referral))
          ),
        ]);

        expect(outcomes.filter(({ _tag }) => _tag === "Success")).toHaveLength(
          1
        );
        expect(outcomes.filter(({ _tag }) => _tag === "Failure")).toHaveLength(
          1
        );
      } finally {
        await fixture.cleanup();
      }
    });

    test("admits a one-minor-unit first booking without an invitation claim, then excludes later invitation pricing", async () => {
      const repository = await makeRepository();
      const referrals = await makeReferralService();
      const fixture = await createInvitedCustomer();
      try {
        const reservation = await createHeldReservation(
          fixture.invitedDotyposCustomerId
        );
        const baseline = Effect.runSync(
          buildCoworkReservationQuote({
            kind: "cowork",
            entryTier: "basic",
            coffee: false,
          })
        );
        const nearFreeCandidate: DiscountCandidate = {
          discount: {
            id: deriveOpaqueDiscountId({
              providerNamespace: "synthetic-customer-credit",
              providerReference: uniqueId(),
            }),
            label: "Synthetic customer credit",
            adjustment: {
              kind: "fixed",
              amount: {
                ...baseline.payment.expectedPrice,
                value: baseline.payment.expectedPrice.value - 1,
              },
            },
          },
          provenance: {
            providerNamespace: "synthetic-customer-credit",
            providerReference: "tiny-first-booking",
          },
        };
        const tiny = makeReferralAdmission({
          reservation,
          invitedDotyposCustomerId: fixture.invitedDotyposCustomerId,
          referrerDotyposCustomerId: fixture.referrerDotyposCustomerId,
          promotionCodeId: fixture.promotionCodeId,
          ordinaryCandidates: [nearFreeCandidate],
        });

        expect(tiny.admission.amount.value).toBe(1);
        const attempt = await Effect.runPromise(
          admit(repository, reservation, tiny)
        );
        const claims = await testDatabase!.pool.query(
          "select id from referral_invitation_claims where payment_attempt_id = $1",
          [attempt.id]
        );
        expect(claims.rows).toHaveLength(0);

        const paid = await Effect.runPromise(
          repository.markPaid({
            id: attempt.id,
            workspaceReservationId: reservation.id,
            paidAt: Temporal.Now.instant(),
          })
        );
        expect(paid.changed).toBe(true);
        const laterInvitation = await Effect.runPromise(
          referrals.resolveInvitationCandidate({
            dotyposCustomerId: fixture.invitedDotyposCustomerId,
            locale: "en-US",
          })
        );
        expect(laterInvitation).toBeUndefined();
      } finally {
        await fixture.cleanup();
      }
    });

    test("preserves ordinary concurrent payments for uninvited and already-paid customers", async () => {
      const repository = await makeRepository();
      for (const alreadyPaid of [false, true]) {
        const fixture = await createInvitedCustomer(alreadyPaid);
        try {
          if (alreadyPaid) {
            await Effect.runPromise(
              workspaceFixtures(testDatabase!.db).reservation({
                stage: { reservation: "confirmed", payment: "paid" },
                customer: fixture.invitedDotyposCustomerId,
              })
            );
          }
          const reservations = await Promise.all([
            createHeldReservation(fixture.invitedDotyposCustomerId),
            createHeldReservation(fixture.invitedDotyposCustomerId),
          ]);
          const outcomes = await Promise.all(
            reservations.map((reservation) =>
              Effect.runPromise(
                Effect.result(
                  admit(
                    repository,
                    reservation,
                    makeOrdinaryAdmission(
                      reservation,
                      fixture.invitedDotyposCustomerId
                    )
                  )
                )
              )
            )
          );

          expect(
            outcomes.filter(({ _tag }) => _tag === "Success")
          ).toHaveLength(2);
        } finally {
          await fixture.cleanup();
        }
      }
    });

    test("reserves the invitation independently alongside an ordinary code or voucher", async () => {
      const repository = await makeRepository();
      for (const kind of ["discount-code", "voucher"] as const) {
        const fixture = await createInvitedCustomer();
        const promotion = await (kind === "discount-code"
          ? createOrdinaryDiscountCode(fixture.invitedDotyposCustomerId)
          : createVoucher(fixture.invitedDotyposCustomerId));
        try {
          const reservation = await createHeldReservation(
            fixture.invitedDotyposCustomerId
          );
          const referral = makeReferralAdmission({
            reservation,
            invitedDotyposCustomerId: fixture.invitedDotyposCustomerId,
            referrerDotyposCustomerId: fixture.referrerDotyposCustomerId,
            promotionCodeId: fixture.promotionCodeId,
            ordinaryCandidates: [promotion.candidate],
          });
          const attempt = await Effect.runPromise(
            admit(repository, reservation, referral)
          );
          const invitation = await testDatabase!.pool.query(
            "select state from referral_invitation_claims where payment_attempt_id = $1",
            [attempt.id]
          );
          const ordinary = await testDatabase!.pool.query(
            kind === "discount-code"
              ? "select state from discount_code_redemptions where payment_attempt_id = $1"
              : "select state from voucher_redemptions where payment_attempt_id = $1",
            [attempt.id]
          );

          expect(invitation.rows).toEqual([{ state: "reserved" }]);
          expect(ordinary.rows).toEqual([{ state: "reserved" }]);
        } finally {
          await fixture.cleanup();
          await promotion.cleanup();
        }
      }
    });

    test("redeems voucher and invitation together on a zero-payable internal payment", async () => {
      const repository = await makeRepository();
      const fixture = await createInvitedCustomer();
      let voucher: Awaited<ReturnType<typeof createVoucher>> | undefined;
      try {
        const reservation = await createHeldReservation(
          fixture.invitedDotyposCustomerId
        );
        const referralOnly = makeReferralAdmission({
          reservation,
          invitedDotyposCustomerId: fixture.invitedDotyposCustomerId,
          referrerDotyposCustomerId: fixture.referrerDotyposCustomerId,
          promotionCodeId: fixture.promotionCodeId,
        });
        voucher = await createVoucher(
          fixture.invitedDotyposCustomerId,
          referralOnly.admission.amount.value
        );
        const fullyCovered = makeReferralAdmission({
          reservation,
          invitedDotyposCustomerId: fixture.invitedDotyposCustomerId,
          referrerDotyposCustomerId: fixture.referrerDotyposCustomerId,
          promotionCodeId: fixture.promotionCodeId,
          creditCandidates: [voucher.candidate],
        });

        expect(fullyCovered.admission.amount.value).toBe(0);
        expect(
          getDiscountCommitmentPayload(
            fullyCovered.admission.commitment
          ).applications.map(({ application }) => application.amount.value)
        ).toEqual([5_250, 29_750]);

        const internal = await Effect.runPromise(
          repository.completeInternalPayment({
            workspaceReservationId: reservation.id,
            amount: fullyCovered.admission.amount,
            commitment: fullyCovered.admission.commitment,
            locale: fullyCovered.locale,
            accountingSnapshot: fullyCovered.snapshot,
          })
        );
        expect(internal.changed).toBe(true);
        expect(internal.attempt.provider).toBe("internal");
        expect(internal.attempt.state).toBe("paid");
        expect(internal.attempt.amount.value).toBe(0);

        const invitationClaims = await testDatabase!.pool.query(
          "select state from referral_invitation_claims where payment_attempt_id = $1",
          [internal.attempt.id]
        );
        const voucherClaims = await testDatabase!.pool.query(
          "select state from voucher_redemptions where payment_attempt_id = $1",
          [internal.attempt.id]
        );
        expect(invitationClaims.rows).toEqual([{ state: "redeemed" }]);
        expect(voucherClaims.rows).toEqual([{ state: "redeemed" }]);

        const laterReservation = await createHeldReservation(
          fixture.invitedDotyposCustomerId
        );
        const secondInvitation = makeReferralAdmission({
          reservation: laterReservation,
          invitedDotyposCustomerId: fixture.invitedDotyposCustomerId,
          referrerDotyposCustomerId: fixture.referrerDotyposCustomerId,
          promotionCodeId: fixture.promotionCodeId,
        });
        const rejectedReferral = await Effect.runPromise(
          Effect.result(admit(repository, laterReservation, secondInvitation))
        );
        expect(rejectedReferral._tag).toBe("Failure");

        const ordinaryRepeat = await Effect.runPromise(
          admit(
            repository,
            laterReservation,
            makeOrdinaryAdmission(
              laterReservation,
              fixture.invitedDotyposCustomerId
            )
          )
        );
        const paidRepeat = await Effect.runPromise(
          repository.markPaid({
            id: ordinaryRepeat.id,
            workspaceReservationId: laterReservation.id,
            paidAt: Temporal.Now.instant(),
          })
        );
        expect(paidRepeat.changed).toBe(true);
      } finally {
        await fixture.cleanup();
        await voucher?.cleanup();
      }
    });

    test("releases failed, cancelled, and expired claims so a new attempt can reserve them", async () => {
      const repository = await makeRepository();
      for (const state of ["failed", "cancelled", "expired"] as const) {
        const fixture = await createInvitedCustomer();
        try {
          const oldReservation = await createHeldReservation(
            fixture.invitedDotyposCustomerId
          );
          const oldReferral = makeReferralAdmission({
            reservation: oldReservation,
            invitedDotyposCustomerId: fixture.invitedDotyposCustomerId,
            referrerDotyposCustomerId: fixture.referrerDotyposCustomerId,
            promotionCodeId: fixture.promotionCodeId,
          });
          const oldAttempt = await Effect.runPromise(
            admit(repository, oldReservation, oldReferral)
          );
          await Effect.runPromise(
            repository.markTerminal({
              id: oldAttempt.id,
              workspaceReservationId: oldReservation.id,
              state,
              failureCode: "synthetic_terminal",
            })
          );
          const released = await testDatabase!.pool.query(
            "select state from referral_invitation_claims where payment_attempt_id = $1",
            [oldAttempt.id]
          );
          expect(released.rows).toEqual([{ state: "released" }]);

          const retryReservation = await createHeldReservation(
            fixture.invitedDotyposCustomerId
          );
          const retry = makeReferralAdmission({
            reservation: retryReservation,
            invitedDotyposCustomerId: fixture.invitedDotyposCustomerId,
            referrerDotyposCustomerId: fixture.referrerDotyposCustomerId,
            promotionCodeId: fixture.promotionCodeId,
          });
          const retryAttempt = await Effect.runPromise(
            admit(repository, retryReservation, retry)
          );
          const reserved = await testDatabase!.pool.query(
            "select state from referral_invitation_claims where payment_attempt_id = $1",
            [retryAttempt.id]
          );
          expect(reserved.rows).toEqual([{ state: "reserved" }]);
          await Effect.runPromise(
            repository.markTerminal({
              id: retryAttempt.id,
              workspaceReservationId: retryReservation.id,
              state: "failed",
              failureCode: "synthetic_retry_cleanup",
            })
          );
        } finally {
          await fixture.cleanup();
        }
      }
    });

    test("does not let late recovery re-admit a released claim after a retry has reserved it", async () => {
      const repository = await makeRepository();
      const lateRecoveries = await makeLateRecoveryRepository();
      const fixture = await createInvitedCustomer();
      try {
        const oldReservation = await createHeldReservation(
          fixture.invitedDotyposCustomerId
        );
        const oldReferral = makeReferralAdmission({
          reservation: oldReservation,
          invitedDotyposCustomerId: fixture.invitedDotyposCustomerId,
          referrerDotyposCustomerId: fixture.referrerDotyposCustomerId,
          promotionCodeId: fixture.promotionCodeId,
        });
        const oldAttempt = await Effect.runPromise(
          admit(repository, oldReservation, oldReferral)
        );
        await Effect.runPromise(
          repository.markTerminal({
            id: oldAttempt.id,
            workspaceReservationId: oldReservation.id,
            state: "failed",
            failureCode: "synthetic_first_failure",
          })
        );

        const retryReservation = await createHeldReservation(
          fixture.invitedDotyposCustomerId
        );
        const retryReferral = makeReferralAdmission({
          reservation: retryReservation,
          invitedDotyposCustomerId: fixture.invitedDotyposCustomerId,
          referrerDotyposCustomerId: fixture.referrerDotyposCustomerId,
          promotionCodeId: fixture.promotionCodeId,
        });
        const retryAttempt = await Effect.runPromise(
          admit(repository, retryReservation, retryReferral)
        );
        await Effect.runPromise(
          lateRecoveries.start({
            paymentAttemptId: oldAttempt.id,
            workspaceReservationId: oldReservation.id,
            webhookEventId: `webhook-${uniqueId()}` as never,
            verifiedPaidAt: Temporal.Now.instant(),
          })
        );
        await Effect.runPromise(
          lateRecoveries.claim({
            paymentAttemptId: oldAttempt.id,
            staleProcessingBefore: Temporal.Now.instant(),
          })
        );

        const conflict = await Effect.runPromise(
          Effect.result(
            lateRecoveries.completeUsingOriginalReservation({
              paymentAttemptId: oldAttempt.id,
              workspaceReservationId: oldReservation.id,
              reservationState: "confirmed",
              completedAt: Temporal.Now.instant(),
            })
          )
        );
        expect(conflict).toMatchObject({
          _tag: "Failure",
          failure: { _tag: "DiscountClaimError", reason: "claim_conflict" },
        });

        await Effect.runPromise(
          lateRecoveries.requireRefund({
            paymentAttemptId: oldAttempt.id,
            workspaceReservationId: oldReservation.id,
            failureCode: "late_payment_discount_unavailable",
            completedAt: Temporal.Now.instant(),
          })
        );
        const refund = await testDatabase!.pool.query(
          "select refund_state from payment_attempts where id = $1",
          [oldAttempt.id]
        );
        expect(refund.rows).toEqual([{ refund_state: "required" }]);

        await Effect.runPromise(
          repository.markTerminal({
            id: retryAttempt.id,
            workspaceReservationId: retryReservation.id,
            state: "failed",
            failureCode: "synthetic_retry_cleanup",
          })
        );
      } finally {
        await fixture.cleanup();
      }
    });

    test("late recovery cannot pass a reserved invitation, then can recover after it is locally paid", async () => {
      const repository = await makeRepository();
      const lateRecoveries = await makeLateRecoveryRepository();
      const fixture = await createInvitedCustomer(false);
      try {
        const oldReservation = await createHeldReservation(
          fixture.invitedDotyposCustomerId
        );
        const oldOrdinary = makeOrdinaryAdmission(
          oldReservation,
          fixture.invitedDotyposCustomerId
        );
        const oldAttempt = await Effect.runPromise(
          admit(repository, oldReservation, oldOrdinary)
        );
        await Effect.runPromise(
          repository.markTerminal({
            id: oldAttempt.id,
            workspaceReservationId: oldReservation.id,
            state: "failed",
            failureCode: "synthetic_provider_failure",
          })
        );

        await fixture.acceptAttribution();
        const referralReservation = await createHeldReservation(
          fixture.invitedDotyposCustomerId
        );
        const referral = makeReferralAdmission({
          reservation: referralReservation,
          invitedDotyposCustomerId: fixture.invitedDotyposCustomerId,
          referrerDotyposCustomerId: fixture.referrerDotyposCustomerId,
          promotionCodeId: fixture.promotionCodeId,
        });
        const referralAttempt = await Effect.runPromise(
          admit(repository, referralReservation, referral)
        );

        await Effect.runPromise(
          lateRecoveries.start({
            paymentAttemptId: oldAttempt.id,
            workspaceReservationId: oldReservation.id,
            webhookEventId: `webhook-${uniqueId()}` as never,
            verifiedPaidAt: Temporal.Now.instant(),
          })
        );
        const processing = await Effect.runPromise(
          lateRecoveries.claim({
            paymentAttemptId: oldAttempt.id,
            staleProcessingBefore: Temporal.Now.instant(),
          })
        );
        expect(processing?.state).toBe("processing");

        const recoveryInput = {
          paymentAttemptId: oldAttempt.id,
          workspaceReservationId: oldReservation.id,
          reservationState: "confirmed" as const,
          completedAt: Temporal.Now.instant(),
        };
        const blockedRecovery = await Effect.runPromise(
          Effect.result(
            lateRecoveries.completeUsingOriginalReservation(recoveryInput)
          )
        );
        expect(blockedRecovery).toMatchObject({
          _tag: "Failure",
          failure: { _tag: "DiscountClaimError", reason: "claim_conflict" },
        });
        expect(
          (
            await Effect.runPromise(
              lateRecoveries.findByPaymentAttemptId(oldAttempt.id)
            )
          )?.state
        ).toBe("processing");

        await Effect.runPromise(
          repository.markPaid({
            id: referralAttempt.id,
            workspaceReservationId: referralReservation.id,
            paidAt: Temporal.Now.instant(),
          })
        );
        await Effect.runPromise(
          lateRecoveries.completeUsingOriginalReservation(recoveryInput)
        );

        expect(
          (
            await Effect.runPromise(
              lateRecoveries.findByPaymentAttemptId(oldAttempt.id)
            )
          )?.state
        ).toBe("recovered");
      } finally {
        await fixture.cleanup();
      }
    });
  }
);

const createReferralCode = async (
  referrerDotyposCustomerId: DotyposCustomerId = customerId()
) => {
  const [promotion] = await Effect.runPromise(
    testDatabase!.db
      .insert(promotionCodes)
      .values({
        kind: "referral",
        code: canonicalPromotionCodeSchema.make(
          `RFL${uniqueId().replaceAll("-", "").slice(0, 12).toUpperCase()}`
        ),
        enabled: true,
      })
      .returning({ id: promotionCodes.id })
  );
  await Effect.runPromise(
    testDatabase!.db.insert(referralCodes).values({
      promotionCodeId: promotion!.id,
      referrerDotyposCustomerId,
    })
  );
  return {
    referrerDotyposCustomerId,
    promotionCodeId: promotion!.id,
    attribute: (invitedDotyposCustomerId: DotyposCustomerId) =>
      Effect.runPromise(
        testDatabase!.db.insert(referralAttributions).values({
          invitedDotyposCustomerId,
          referrerDotyposCustomerId,
          promotionCodeId: promotion!.id,
        })
      ),
    cleanup: async () => {
      await testDatabase!.pool.query(
        "delete from referral_attributions where promotion_code_id = $1",
        [promotion!.id]
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

const readAttributions = async (invitedDotyposCustomerId: DotyposCustomerId) =>
  (
    await testDatabase!.pool.query(
      "select referrer_dotypos_customer_id as referrer, promotion_code_id as code from referral_attributions where invited_dotypos_customer_id = $1",
      [invitedDotyposCustomerId]
    )
  ).rows;

const readClaim = async (paymentAttemptId: string) =>
  (
    await testDatabase!.pool.query(
      "select state, referrer_dotypos_customer_id as referrer, promotion_code_id as code from referral_invitation_claims where payment_attempt_id = $1",
      [paymentAttemptId]
    )
  ).rows;

const admitCheckoutReferral = async (
  repository: IPaymentLifecycleRepository,
  fixture: {
    readonly invitedDotyposCustomerId: DotyposCustomerId;
    readonly referrerDotyposCustomerId: DotyposCustomerId;
    readonly promotionCodeId: string;
  },
  reservation?: Reservation
) => {
  const held =
    reservation ??
    (await createHeldReservation(fixture.invitedDotyposCustomerId));
  const attempt = await Effect.runPromise(
    admit(
      repository,
      held,
      makeReferralAdmission({ reservation: held, ...fixture })
    )
  );
  return { reservation: held, attempt };
};

describe.skipIf(!testDatabase)(
  "Checkout referral attribution at payment on disposable Postgres",
  () => {
    test("reserves a checkout referral without attribution and records the attribution when paid", async () => {
      const repository = await makeRepository();
      const fixture = await createInvitedCustomer(false);
      try {
        const { reservation, attempt } = await admitCheckoutReferral(
          repository,
          fixture
        );
        expect(await readClaim(attempt.id)).toEqual([
          {
            state: "reserved",
            referrer: fixture.referrerDotyposCustomerId,
            code: fixture.promotionCodeId,
          },
        ]);
        expect(
          await readAttributions(fixture.invitedDotyposCustomerId)
        ).toEqual([]);

        const paid = await Effect.runPromise(
          repository.markPaid({
            id: attempt.id,
            workspaceReservationId: reservation.id,
            paidAt: Temporal.Now.instant(),
          })
        );

        expect(paid.changed).toBe(true);
        expect((await readClaim(attempt.id))[0]?.state).toBe("redeemed");
        expect(
          await readAttributions(fixture.invitedDotyposCustomerId)
        ).toEqual([
          {
            referrer: fixture.referrerDotyposCustomerId,
            code: fixture.promotionCodeId,
          },
        ]);
      } finally {
        await fixture.cleanup();
      }
    });

    test("persists a paid guest referral after a Calendar sale as one invitation application counted in savings", async () => {
      const repository = await makeRepository();
      const fixture = await createInvitedCustomer(false);
      const inviteeAccountId = customerAccountIdSchema.make(
        `referral-guest-savings-${uniqueId()}`
      );
      const occurrenceReference = `guest-referral-sale-${uniqueId()}`;
      const calendarSale: DiscountCandidate = {
        discount: {
          id: deriveOpaqueDiscountId({
            providerNamespace: "google-calendar-sales",
            providerReference: occurrenceReference,
          }),
          label: "Calendar sale",
          adjustment: { kind: "percentage", basisPoints: 2_000 },
        },
        provenance: {
          providerNamespace: "google-calendar-sales",
          providerReference: occurrenceReference,
          details: {
            calendarId: "synthetic-sales-calendar",
            eventReference: occurrenceReference,
            occurrenceDate: "2099-01-01",
            storedDiscountId: storedDiscountIdSchema.make(uniqueId()),
          },
        },
      };
      try {
        // A guest booking: no attribution and no linked account before payment.
        const reservation = await createHeldReservation(
          fixture.invitedDotyposCustomerId
        );
        const referralAdmission = makeReferralAdmission({
          reservation,
          ...fixture,
          ordinaryCandidates: [calendarSale],
        });
        const attempt = await Effect.runPromise(
          admit(repository, reservation, referralAdmission)
        );
        await Effect.runPromise(
          repository.markPaid({
            id: attempt.id,
            workspaceReservationId: reservation.id,
            paidAt: Temporal.Now.instant(),
          })
        );

        const applications = await Effect.runPromise(
          testDatabase!.db
            .select({
              id: discountApplications.id,
              sequence: discountApplications.sequence,
              publicDiscountId: discountApplications.publicDiscountId,
              subtotalBefore: discountApplications.subtotalBeforeValue,
              applied: discountApplications.appliedAmountValue,
            })
            .from(discountApplications)
            .where(eq(discountApplications.paymentAttemptId, attempt.id))
            .orderBy(discountApplications.sequence)
        );
        const invitationId = getReferralInvitationDiscountId(
          fixture.invitedDotyposCustomerId
        );
        const [sale, invitation] = applications;
        expect(
          applications.filter(
            ({ publicDiscountId }) => publicDiscountId === invitationId
          )
        ).toHaveLength(1);
        expect(applications).toHaveLength(2);
        expect(sale).toMatchObject({
          sequence: 0,
          publicDiscountId: calendarSale.discount.id,
          subtotalBefore: 35_000,
          applied: 7_000,
        });
        // The invitation takes 15% of what the sale leaves.
        expect(invitation).toMatchObject({
          sequence: 1,
          publicDiscountId: invitationId,
          subtotalBefore: 28_000,
          applied: 4_200,
        });
        expect(attempt.amount.value).toBe(23_800);
        const [claim] = (
          await testDatabase!.pool.query(
            "select state, application_id from referral_invitation_claims where payment_attempt_id = $1",
            [attempt.id]
          )
        ).rows;
        expect(claim).toEqual({
          state: "redeemed",
          application_id: invitation!.id,
        });
        expect(
          await readAttributions(fixture.invitedDotyposCustomerId)
        ).toEqual([
          {
            referrer: fixture.referrerDotyposCustomerId,
            code: fixture.promotionCodeId,
          },
        ]);

        // Once the guest signs in, the Referrals screen counts the invitation.
        await Effect.runPromise(
          workspaceFixtures(testDatabase!.db).account("referral-guest", {
            id: inviteeAccountId,
            verified: false,
            linkedCustomer: fixture.invitedDotyposCustomerId,
          })
        );
        const identity = {
          accountId: inviteeAccountId,
          dotyposCustomerId: fixture.invitedDotyposCustomerId,
        };
        const referrals = await makeReferralService({ identity });
        const summary = await Effect.runPromise(
          referrals.getAccountSummary({
            customerAccountId: inviteeAccountId,
            dotyposCustomerId: fixture.invitedDotyposCustomerId,
          })
        );
        expect(summary.savings).toEqual([
          { value: 4_200, exponent: 2, currency: "CZK" },
        ]);
      } finally {
        await fixture.cleanup();
        const issued = await testDatabase!.pool.query<{
          readonly id: string;
        }>(
          "delete from referral_codes where referrer_dotypos_customer_id = $1 returning promotion_code_id as id",
          [fixture.invitedDotyposCustomerId]
        );
        await testDatabase!.pool.query(
          "delete from promotion_codes where id = any($1)",
          [issued.rows.map(({ id }) => id)]
        );
        await testDatabase!.pool.query(
          'delete from auth."user" where id = $1',
          [inviteeAccountId]
        );
        await testDatabase!.pool.query(
          "delete from customer_accounts where id = $1",
          [inviteeAccountId]
        );
      }
    });

    test("releases a checkout referral on failed, cancelled, or expired payment and leaves no attribution", async () => {
      const repository = await makeRepository();
      for (const state of ["failed", "cancelled", "expired"] as const) {
        const fixture = await createInvitedCustomer(false);
        try {
          const { reservation, attempt } = await admitCheckoutReferral(
            repository,
            fixture
          );
          await Effect.runPromise(
            repository.markTerminal({
              id: attempt.id,
              workspaceReservationId: reservation.id,
              state,
              failureCode: "synthetic_terminal",
            })
          );

          expect((await readClaim(attempt.id))[0]?.state).toBe("released");
          expect(
            await readAttributions(fixture.invitedDotyposCustomerId)
          ).toEqual([]);
        } finally {
          await fixture.cleanup();
        }
      }
    });

    test("refuses admission when the customer was attributed to a different referrer since pricing", async () => {
      const repository = await makeRepository();
      const fixture = await createInvitedCustomer(false);
      const other = await createReferralCode();
      try {
        await other.attribute(fixture.invitedDotyposCustomerId);
        const reservation = await createHeldReservation(
          fixture.invitedDotyposCustomerId
        );

        const admission = await Effect.runPromise(
          Effect.result(
            admit(
              repository,
              reservation,
              makeReferralAdmission({ reservation, ...fixture })
            )
          )
        );

        expect(admission).toMatchObject({
          _tag: "Failure",
          failure: { _tag: "DiscountClaimError", reason: "claim_conflict" },
        });
      } finally {
        await fixture.cleanup();
        await other.cleanup();
      }
    });

    test("admits exactly one of two concurrent checkout referrals with different codes and attributes its referrer", async () => {
      const repository = await makeRepository();
      const fixture = await createInvitedCustomer(false);
      const other = await createReferralCode();
      try {
        const contenders = [fixture, { ...fixture, ...other }] as const;
        const reservations = await Promise.all(
          contenders.map(() =>
            createHeldReservation(fixture.invitedDotyposCustomerId)
          )
        );
        const outcomes = await Promise.all(
          contenders.map((contender, index) =>
            Effect.runPromise(
              Effect.result(
                admit(
                  repository,
                  reservations[index]!,
                  makeReferralAdmission({
                    reservation: reservations[index]!,
                    invitedDotyposCustomerId: fixture.invitedDotyposCustomerId,
                    referrerDotyposCustomerId:
                      contender.referrerDotyposCustomerId,
                    promotionCodeId: contender.promotionCodeId,
                  })
                )
              )
            )
          )
        );

        const winner = outcomes.findIndex(({ _tag }) => _tag === "Success");
        expect(outcomes.filter(({ _tag }) => _tag === "Success")).toHaveLength(
          1
        );
        expect(outcomes[1 - winner]).toMatchObject({
          _tag: "Failure",
          failure: { _tag: "DiscountClaimError", reason: "claim_conflict" },
        });

        const admitted = outcomes[winner]!;
        if (admitted._tag !== "Success") throw new Error("No admission won");
        await Effect.runPromise(
          repository.markPaid({
            id: admitted.success.id,
            workspaceReservationId: reservations[winner]!.id,
            paidAt: Temporal.Now.instant(),
          })
        );
        expect(
          await readAttributions(fixture.invitedDotyposCustomerId)
        ).toEqual([
          {
            referrer: contenders[winner]!.referrerDotyposCustomerId,
            code: contenders[winner]!.promotionCodeId,
          },
        ]);
      } finally {
        await fixture.cleanup();
        await other.cleanup();
      }
    });

    test("blocks an ordinary first payment while a checkout referral holds the invitation", async () => {
      const repository = await makeRepository();
      const fixture = await createInvitedCustomer(false);
      try {
        await admitCheckoutReferral(repository, fixture);
        const ordinaryReservation = await createHeldReservation(
          fixture.invitedDotyposCustomerId
        );

        const ordinary = await Effect.runPromise(
          Effect.result(
            admit(
              repository,
              ordinaryReservation,
              makeOrdinaryAdmission(
                ordinaryReservation,
                fixture.invitedDotyposCustomerId
              )
            )
          )
        );

        expect(ordinary).toMatchObject({
          _tag: "Failure",
          failure: { _tag: "PaymentLifecycleStateError" },
        });
      } finally {
        await fixture.cleanup();
      }
    });

    test("late recovery to paid records the checkout referral's attribution", async () => {
      const repository = await makeRepository();
      const lateRecoveries = await makeLateRecoveryRepository();
      const fixture = await createInvitedCustomer(false);
      try {
        const { reservation, attempt } = await admitCheckoutReferral(
          repository,
          fixture
        );
        await Effect.runPromise(
          repository.markTerminal({
            id: attempt.id,
            workspaceReservationId: reservation.id,
            state: "failed",
            failureCode: "synthetic_provider_failure",
          })
        );
        await Effect.runPromise(
          lateRecoveries.start({
            paymentAttemptId: attempt.id,
            workspaceReservationId: reservation.id,
            webhookEventId: `webhook-${uniqueId()}` as never,
            verifiedPaidAt: Temporal.Now.instant(),
          })
        );
        await Effect.runPromise(
          lateRecoveries.claim({
            paymentAttemptId: attempt.id,
            staleProcessingBefore: Temporal.Now.instant(),
          })
        );

        await Effect.runPromise(
          lateRecoveries.completeUsingOriginalReservation({
            paymentAttemptId: attempt.id,
            workspaceReservationId: reservation.id,
            reservationState: "confirmed",
            completedAt: Temporal.Now.instant(),
          })
        );

        expect((await readClaim(attempt.id))[0]?.state).toBe("redeemed");
        expect(
          await readAttributions(fixture.invitedDotyposCustomerId)
        ).toEqual([
          {
            referrer: fixture.referrerDotyposCustomerId,
            code: fixture.promotionCodeId,
          },
        ]);
      } finally {
        await fixture.cleanup();
      }
    });

    test("completes payment and keeps the graph when a different referrer or a cycle appeared after admission", async () => {
      const repository = await makeRepository();
      for (const conflict of ["different-referrer", "cycle"] as const) {
        const fixture = await createInvitedCustomer(false);
        const other = await createReferralCode(
          conflict === "cycle" ? fixture.invitedDotyposCustomerId : undefined
        );
        try {
          const { reservation, attempt } = await admitCheckoutReferral(
            repository,
            fixture
          );
          // Synthetic graph change between admission and payment.
          await other.attribute(
            conflict === "cycle"
              ? fixture.referrerDotyposCustomerId
              : fixture.invitedDotyposCustomerId
          );

          const paid = await Effect.runPromise(
            repository.markPaid({
              id: attempt.id,
              workspaceReservationId: reservation.id,
              paidAt: Temporal.Now.instant(),
            })
          );

          expect(paid.changed).toBe(true);
          expect((await readClaim(attempt.id))[0]?.state).toBe("redeemed");
          expect(
            await readAttributions(fixture.invitedDotyposCustomerId)
          ).toEqual(
            conflict === "cycle"
              ? []
              : [
                  {
                    referrer: other.referrerDotyposCustomerId,
                    code: other.promotionCodeId,
                  },
                ]
          );
        } finally {
          await fixture.cleanup();
          await other.cleanup();
        }
      }
    });

    test("records the attribution on a zero-payable internal payment", async () => {
      const repository = await makeRepository();
      const fixture = await createInvitedCustomer(false);
      let voucher: Awaited<ReturnType<typeof createVoucher>> | undefined;
      try {
        const reservation = await createHeldReservation(
          fixture.invitedDotyposCustomerId
        );
        const referralOnly = makeReferralAdmission({ reservation, ...fixture });
        voucher = await createVoucher(
          fixture.invitedDotyposCustomerId,
          referralOnly.admission.amount.value
        );
        const fullyCovered = makeReferralAdmission({
          reservation,
          ...fixture,
          creditCandidates: [voucher.candidate],
        });

        const internal = await Effect.runPromise(
          repository.completeInternalPayment({
            workspaceReservationId: reservation.id,
            amount: fullyCovered.admission.amount,
            commitment: fullyCovered.admission.commitment,
            locale: fullyCovered.locale,
            accountingSnapshot: fullyCovered.snapshot,
          })
        );

        expect(internal.attempt.state).toBe("paid");
        expect(
          await readAttributions(fixture.invitedDotyposCustomerId)
        ).toEqual([
          {
            referrer: fixture.referrerDotyposCustomerId,
            code: fixture.promotionCodeId,
          },
        ]);
      } finally {
        await fixture.cleanup();
        await voucher?.cleanup();
      }
    });

    test("takes the referral graph lock before the invitee's first-booking lock when payment records an attribution", async () => {
      const repository = await makeRepository();
      const fixture = await createInvitedCustomer(false);
      const graphHolder = await testDatabase!.pool.connect();
      try {
        const { reservation, attempt } = await admitCheckoutReferral(
          repository,
          fixture
        );
        await graphHolder.query("begin");
        await graphHolder.query(
          "select pg_advisory_xact_lock(hashtext('referral-attribution'), hashtext('graph'))"
        );

        let settled = false;
        const payment = Effect.runPromise(
          repository.markPaid({
            id: attempt.id,
            workspaceReservationId: reservation.id,
            paidAt: Temporal.Now.instant(),
          })
        ).finally(() => {
          settled = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 300));

        // Still waiting on the graph lock, so it cannot hold first-booking.
        const firstBooking = await testDatabase!.pool.query<{
          readonly locked: boolean;
        }>(
          "select pg_try_advisory_xact_lock(hashtext('referral-first-booking'), hashtext($1)) as locked",
          [fixture.invitedDotyposCustomerId]
        );
        expect(firstBooking.rows[0]?.locked).toBe(true);
        expect(settled).toBe(false);

        await graphHolder.query("rollback");
        expect((await payment).changed).toBe(true);
        expect(
          await readAttributions(fixture.invitedDotyposCustomerId)
        ).toHaveLength(1);
      } finally {
        graphHolder.release();
        await fixture.cleanup();
      }
    });

    // Checkout completes a signed-in payment inside the account guard, which
    // holds the account lock in a section on another connection; a guest's
    // payment has no account section. The bound applies to both.
    for (const [checkout, inAccountSection] of [
      ["inside the account guard", true],
      ["for a guest, with no account section", false],
    ] as const) {
      test(`fails a zero-payable internal payment ${checkout} cleanly after the bounded graph-lock wait, then lets it retry`, async () => {
        const repository = await makeRepository();
        const fixture = await createInvitedCustomer(false);
        const graphHolder = await testDatabase!.pool.connect();
        let voucher: Awaited<ReturnType<typeof createVoucher>> | undefined;
        try {
          const reservation = await createHeldReservation(
            fixture.invitedDotyposCustomerId
          );
          const referralOnly = makeReferralAdmission({
            reservation,
            ...fixture,
          });
          voucher = await createVoucher(
            fixture.invitedDotyposCustomerId,
            referralOnly.admission.amount.value
          );
          const fullyCovered = makeReferralAdmission({
            reservation,
            ...fixture,
            creditCandidates: [voucher.candidate],
          });
          const completeInternalPayment = () => {
            const payment = repository.completeInternalPayment({
              workspaceReservationId: reservation.id,
              amount: fullyCovered.admission.amount,
              commitment: fullyCovered.admission.commitment,
              locale: fullyCovered.locale,
              accountingSnapshot: fullyCovered.snapshot,
            });
            return inAccountSection ? inAccountGuard(payment) : payment;
          };
          const readPaymentRows = async () => ({
            reservation: (
              await testDatabase!.pool.query(
                "select payment_state, active_payment_attempt_id, paid_at from workspace_reservations where id = $1",
                [reservation.id]
              )
            ).rows,
            attempts: (
              await testDatabase!.pool.query(
                "select state from payment_attempts where workspace_reservation_id = $1",
                [reservation.id]
              )
            ).rows,
            snapshots: (
              await testDatabase!.pool.query(
                "select payment_attempt_id from accounting_document_snapshots where workspace_reservation_id = $1",
                [reservation.id]
              )
            ).rows,
            applications: (
              await testDatabase!.pool.query(
                "select public_discount_id from discount_applications where workspace_reservation_id = $1",
                [reservation.id]
              )
            ).rows,
            invitationClaims: (
              await testDatabase!.pool.query(
                "select state from referral_invitation_claims where invited_dotypos_customer_id = $1",
                [fixture.invitedDotyposCustomerId]
              )
            ).rows,
            voucherClaims: (
              await testDatabase!.pool.query(
                "select state from voucher_redemptions where dotypos_customer_id = $1",
                [fixture.invitedDotyposCustomerId]
              )
            ).rows,
            attributions: await readAttributions(
              fixture.invitedDotyposCustomerId
            ),
          });
          const before = await readPaymentRows();
          expect(before).toEqual({
            reservation: [
              {
                payment_state: "not_started",
                active_payment_attempt_id: null,
                paid_at: null,
              },
            ],
            attempts: [],
            snapshots: [],
            applications: [],
            invitationClaims: [],
            voucherClaims: [],
            attributions: [],
          });

          // A concurrent acceptReferral holds the graph lock past the bound.
          await graphHolder.query("begin");
          await graphHolder.query(
            "select pg_advisory_xact_lock(hashtext('referral-attribution'), hashtext('graph'))"
          );
          const startedAt = performance.now();
          const timedOut = await Effect.runPromise(
            Effect.exit(completeInternalPayment())
          );
          const waitedMillis = performance.now() - startedAt;
          await graphHolder.query("rollback");

          // The graph lock wait gives up at the 5s bound with a lock timeout,
          // well before the pool's 10s query timeouts would cancel it.
          expect(waitedMillis).toBeGreaterThanOrEqual(4_900);
          const failure = Exit.isFailure(timedOut)
            ? Cause.squash(timedOut.cause)
            : undefined;
          expect(failure).toMatchObject({
            _tag: "EffectDrizzleQueryError",
            params: ["referral-attribution", "graph"],
          });
          const queryCause = Predicate.hasProperty(failure, "cause")
            ? failure.cause
            : undefined;
          expect(
            Cause.isCause(queryCause) ? Cause.squash(queryCause) : queryCause
          ).toMatchObject({
            _tag: "SqlError",
            reason: { _tag: "LockTimeoutError" },
          });
          expect(await readPaymentRows()).toEqual(before);

          const retried = await Effect.runPromise(completeInternalPayment());
          expect(retried.changed).toBe(true);
          expect(retried.attempt.state).toBe("paid");
          const after = await readPaymentRows();
          expect(after.reservation[0]?.payment_state).toBe("paid");
          expect(after.attempts).toEqual([{ state: "paid" }]);
          expect(after.invitationClaims).toEqual([{ state: "redeemed" }]);
          expect(after.voucherClaims).toEqual([{ state: "redeemed" }]);
          expect(after.attributions).toEqual([
            {
              referrer: fixture.referrerDotyposCustomerId,
              code: fixture.promotionCodeId,
            },
          ]);
        } finally {
          await graphHolder.query("rollback").catch(() => {});
          graphHolder.release();
          await fixture.cleanup();
          await voucher?.cleanup();
        }
      });
    }

    test("restores the transaction's previous lock_timeout after the bounded graph-lock wait", async () => {
      const repository = await makeRepository();
      const fixture = await createInvitedCustomer(false);
      let voucher: Awaited<ReturnType<typeof createVoucher>> | undefined;
      try {
        const reservation = await createHeldReservation(
          fixture.invitedDotyposCustomerId
        );
        const referralOnly = makeReferralAdmission({ reservation, ...fixture });
        voucher = await createVoucher(
          fixture.invitedDotyposCustomerId,
          referralOnly.admission.amount.value
        );
        const fullyCovered = makeReferralAdmission({
          reservation,
          ...fixture,
          creditCandidates: [voucher.candidate],
        });

        const [transition, lockTimeout] = await Effect.runPromise(
          inAccountGuard(
            Effect.gen(function* () {
              const { db, transaction } = yield* WorkspaceDatabase;
              return yield* transaction(
                Effect.gen(function* () {
                  yield* db.execute(sql`set local lock_timeout = '7s'`);
                  const transition = yield* repository.completeInternalPayment({
                    workspaceReservationId: reservation.id,
                    amount: fullyCovered.admission.amount,
                    commitment: fullyCovered.admission.commitment,
                    locale: fullyCovered.locale,
                    accountingSnapshot: fullyCovered.snapshot,
                  });
                  const { rows } = yield* db.execute<{
                    readonly lock_timeout: string;
                  }>(
                    sql`select current_setting('lock_timeout') as lock_timeout`
                  );
                  return [transition, rows[0]?.lock_timeout] as const;
                })
              );
            }).pipe(Effect.provide(testDatabase!.layer))
          )
        );

        expect(transition.changed).toBe(true);
        expect(transition.attempt.state).toBe("paid");
        expect(lockTimeout).toBe("7s");
        expect(
          await readAttributions(fixture.invitedDotyposCustomerId)
        ).toEqual([
          {
            referrer: fixture.referrerDotyposCustomerId,
            code: fixture.promotionCodeId,
          },
        ]);
      } finally {
        await fixture.cleanup();
        await voucher?.cleanup();
      }
    });
  }
);

describe.skipIf(!testDatabase)(
  "Checkout referral payments after the referral program was withheld",
  () => {
    const holdGraphLock = async () => {
      const holder = await testDatabase!.pool.connect();
      await holder.query("begin");
      await holder.query(
        "select pg_advisory_xact_lock(hashtext('referral-attribution'), hashtext('graph'))"
      );
      return {
        release: async () => {
          await holder.query("rollback").catch(() => {});
          holder.release();
        },
      };
    };

    test.each(withheldReferralFlags)(
      "attributes a referral admitted while released when it is paid with the flag %s, taking the graph lock first",
      async (_flag, flagLayer) => {
        const repository = await makeRepository();
        const fixture = await createInvitedCustomer(false);
        let graphLock: Awaited<ReturnType<typeof holdGraphLock>> | undefined;
        try {
          // Admitted while the program was released.
          const { reservation, attempt } = await admitCheckoutReferral(
            repository,
            fixture
          );
          graphLock = await holdGraphLock();

          const payment = Effect.runPromise(
            repository
              .markPaid({
                id: attempt.id,
                workspaceReservationId: reservation.id,
                paidAt: Temporal.Now.instant(),
              })
              .pipe(Effect.provide(flagLayer))
          );
          // The admitted referral is honored: payment waits for the graph.
          await waitForAdvisoryLockWaiter(testDatabase!.pool, [
            "referral-attribution",
            "graph",
          ]);
          await graphLock.release();
          graphLock = undefined;

          expect((await payment).changed).toBe(true);
          expect((await readClaim(attempt.id))[0]?.state).toBe("redeemed");
          expect(
            await readAttributions(fixture.invitedDotyposCustomerId)
          ).toEqual([
            {
              referrer: fixture.referrerDotyposCustomerId,
              code: fixture.promotionCodeId,
            },
          ]);
        } finally {
          await graphLock?.release();
          await fixture.cleanup();
        }
      }
    );

    test("attributes a zero-payable internal payment admitted with a referral while the flag is off", async () => {
      const repository = await makeRepository();
      const fixture = await createInvitedCustomer(false);
      let voucher: Awaited<ReturnType<typeof createVoucher>> | undefined;
      try {
        const reservation = await createHeldReservation(
          fixture.invitedDotyposCustomerId
        );
        const referralOnly = makeReferralAdmission({ reservation, ...fixture });
        voucher = await createVoucher(
          fixture.invitedDotyposCustomerId,
          referralOnly.admission.amount.value
        );
        const fullyCovered = makeReferralAdmission({
          reservation,
          ...fixture,
          creditCandidates: [voucher.candidate],
        });

        const internal = await Effect.runPromise(
          repository
            .completeInternalPayment({
              workspaceReservationId: reservation.id,
              amount: fullyCovered.admission.amount,
              commitment: fullyCovered.admission.commitment,
              locale: fullyCovered.locale,
              accountingSnapshot: fullyCovered.snapshot,
            })
            .pipe(Effect.provide(referralFeatureFlag(false)))
        );

        expect(internal.attempt.state).toBe("paid");
        expect((await readClaim(internal.attempt.id))[0]?.state).toBe(
          "redeemed"
        );
        expect(
          await readAttributions(fixture.invitedDotyposCustomerId)
        ).toEqual([
          {
            referrer: fixture.referrerDotyposCustomerId,
            code: fixture.promotionCodeId,
          },
        ]);
      } finally {
        await fixture.cleanup();
        await voucher?.cleanup();
      }
    });

    test("late recovery to paid attributes a referral admitted while released, while the flag is off", async () => {
      const repository = await makeRepository();
      const lateRecoveries = await makeLateRecoveryRepository();
      const fixture = await createInvitedCustomer(false);
      try {
        const { reservation, attempt } = await admitCheckoutReferral(
          repository,
          fixture
        );
        await Effect.runPromise(
          repository.markTerminal({
            id: attempt.id,
            workspaceReservationId: reservation.id,
            state: "failed",
            failureCode: "synthetic_provider_failure",
          })
        );
        await Effect.runPromise(
          lateRecoveries.start({
            paymentAttemptId: attempt.id,
            workspaceReservationId: reservation.id,
            webhookEventId: `webhook-${uniqueId()}` as never,
            verifiedPaidAt: Temporal.Now.instant(),
          })
        );
        await Effect.runPromise(
          lateRecoveries.claim({
            paymentAttemptId: attempt.id,
            staleProcessingBefore: Temporal.Now.instant(),
          })
        );

        await Effect.runPromise(
          lateRecoveries
            .completeUsingOriginalReservation({
              paymentAttemptId: attempt.id,
              workspaceReservationId: reservation.id,
              reservationState: "confirmed",
              completedAt: Temporal.Now.instant(),
            })
            .pipe(Effect.provide(referralFeatureFlag(false)))
        );

        expect((await readClaim(attempt.id))[0]?.state).toBe("redeemed");
        expect(
          await readAttributions(fixture.invitedDotyposCustomerId)
        ).toEqual([
          {
            referrer: fixture.referrerDotyposCustomerId,
            code: fixture.promotionCodeId,
          },
        ]);
      } finally {
        await fixture.cleanup();
      }
    });

    test("writes no attribution for a payment without an admitted referral while the flag is off", async () => {
      const repository = await makeRepository();
      const fixture = await createInvitedCustomer(false);
      try {
        const reservation = await createHeldReservation(
          fixture.invitedDotyposCustomerId
        );
        const attempt = await Effect.runPromise(
          admit(
            repository,
            reservation,
            makeOrdinaryAdmission(reservation, fixture.invitedDotyposCustomerId)
          )
        );

        const paid = await Effect.runPromise(
          repository
            .markPaid({
              id: attempt.id,
              workspaceReservationId: reservation.id,
              paidAt: Temporal.Now.instant(),
            })
            .pipe(Effect.provide(referralFeatureFlag(false)))
        );

        expect(paid.changed).toBe(true);
        expect(await readClaim(attempt.id)).toEqual([]);
        expect(
          await readAttributions(fixture.invitedDotyposCustomerId)
        ).toEqual([]);
      } finally {
        await fixture.cleanup();
      }
    });
  }
);

describe.skipIf(!testDatabase)(
  "Referral acceptance with admission waiters in a bounded pool",
  () => {
    for (const max of [2, 10] as const) {
      test(`completes acceptance while ${max - 1} referral admissions wait on its lock in a pool of ${max}`, {
        timeout: 30_000,
      }, async () => {
        const fixture = await createInvitedCustomer(false);
        const inviteeAccountId = customerAccountIdSchema.make(
          `referral-pool-invitee-${uniqueId()}`
        );
        const referrerAccountId = customerAccountIdSchema.make(
          `referral-pool-referrer-${uniqueId()}`
        );
        const applicationName = `referral-pool-${max}-${uniqueId().slice(0, 8)}`;
        const pool = makeDatabasePool({
          connectionString: process.env.WORKSPACE_TEST_DATABASE_URL!,
          ...databasePoolTimeouts,
          connectionTimeoutMillis: 1_500,
          application_name: applicationName,
          max,
        });
        let releaseHistory!: () => void;
        let notifyHistoryStarted!: () => void;
        const historyGate = new Promise<void>((resolve) => {
          releaseHistory = resolve;
        });
        const historyStarted = new Promise<void>((resolve) => {
          notifyHistoryStarted = resolve;
        });
        let acceptancePromise: Promise<unknown> | undefined;
        const admissionPromises: Promise<unknown>[] = [];

        try {
          const accounts = workspaceFixtures(testDatabase!.db);
          await Effect.runPromise(
            Effect.all([
              accounts.account("referral-pool-invitee", {
                id: inviteeAccountId,
                verified: false,
                linkedCustomer: fixture.invitedDotyposCustomerId,
              }),
              accounts.account("referral-pool-referrer", {
                id: referrerAccountId,
                verified: false,
                linkedCustomer: fixture.referrerDotyposCustomerId,
              }),
            ])
          );

          const db = await Effect.runPromise(makeDatabaseClient(pool));
          const databaseLayer = Layer.succeed(
            WorkspaceDatabase,
            WorkspaceDatabase.make(db)
          );
          const repository = await makeRepository(databaseLayer);
          const referrals = await makeReferralService({
            databaseLayer,
            pool,
            identity: {
              accountId: inviteeAccountId,
              dotyposCustomerId: fixture.invitedDotyposCustomerId,
            },
            listReservations: () =>
              Effect.promise(async () => {
                notifyHistoryStarted();
                await historyGate;
                return [];
              }),
          });

          acceptancePromise = Effect.runPromise(
            Effect.result(
              referrals.acceptReferral({
                code: fixture.code,
                customerAccountId: inviteeAccountId,
                dotyposCustomerId: fixture.invitedDotyposCustomerId,
              })
            )
          );
          await Promise.race([
            historyStarted,
            new Promise<never>((_, reject) =>
              setTimeout(
                () =>
                  reject(new Error("Referral history gate was not reached")),
                5_000
              )
            ),
          ]);

          const waiterCount = max - 1;
          const reservations = await Promise.all(
            Array.from({ length: waiterCount }, () =>
              createHeldReservation(fixture.invitedDotyposCustomerId)
            )
          );
          for (const reservation of reservations) {
            const referralAdmission = makeReferralAdmission({
              reservation,
              invitedDotyposCustomerId: fixture.invitedDotyposCustomerId,
              referrerDotyposCustomerId: fixture.referrerDotyposCustomerId,
              promotionCodeId: fixture.promotionCodeId,
            });
            admissionPromises.push(
              Effect.runPromise(
                Effect.result(admit(repository, reservation, referralAdmission))
              )
            );
          }

          const deadline = Date.now() + 5_000;
          let blockedWaiters = 0;
          while (Date.now() < deadline && blockedWaiters < waiterCount) {
            const activity = await testDatabase!.pool.query<{
              readonly count: number;
            }>(
              `select count(*)::int as count
                 from pg_stat_activity
                 where application_name = $1
                   and state = 'active'
                   and wait_event_type = 'Lock'
                   and query ilike '%pg_advisory_xact_lock%'`,
              [applicationName]
            );
            blockedWaiters = activity.rows[0]?.count ?? 0;
            if (blockedWaiters < waiterCount) {
              await new Promise((resolve) => setTimeout(resolve, 50));
            }
          }
          expect(blockedWaiters).toBe(waiterCount);

          releaseHistory();
          const acceptance = await acceptancePromise;
          expect(acceptance).toMatchObject({
            _tag: "Success",
            success: { kind: "accepted" },
          });

          const admissionOutcomes = await Promise.all(admissionPromises);
          expect(
            admissionOutcomes.filter(({ _tag }) => _tag === "Success")
          ).toHaveLength(1);
          expect(pool.waitingCount).toBe(0);
          expect(pool.idleCount).toBe(pool.totalCount);
        } finally {
          releaseHistory();
          if (acceptancePromise) {
            await Promise.allSettled([acceptancePromise]);
          }
          await Promise.allSettled(admissionPromises);
          await fixture.cleanup();
          await testDatabase!.pool.query(
            'delete from auth."user" where id = any($1)',
            [[inviteeAccountId, referrerAccountId]]
          );
          await testDatabase!.pool.query(
            "delete from customer_accounts where id = any($1)",
            [[inviteeAccountId, referrerAccountId]]
          );
          await pool.end();
        }
      });
    }
  }
);

describe.skipIf(!testDatabase)(
  "PaymentLifecycleRepository on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const reservationIds: WorkspaceReservationId[] = [];
    const discountIds: StoredDiscountId[] = [];

    const voucherIds: string[] = [];

    afterAll(async () => {
      await testDatabase.pool.query(
        "delete from voucher_redemptions where voucher_id = any($1)",
        [voucherIds]
      );
      await testDatabase.pool.query(
        "delete from promotion_codes where id in (select promotion_code_id from vouchers where id = any($1))",
        [voucherIds]
      );
      // Snapshots may only be deleted once their attempt is terminal.
      await testDatabase.pool.query(
        "update payment_attempts set state = 'expired', failure_code = 'synthetic_cleanup' where workspace_reservation_id = any($1)",
        [reservationIds]
      );
      await testDatabase.pool.query(
        "delete from accounting_document_snapshots where workspace_reservation_id = any($1)",
        [reservationIds]
      );
      await testDatabase.pool.query(
        "delete from discount_code_redemptions where application_id in (select id from discount_applications where workspace_reservation_id = any($1))",
        [reservationIds]
      );
      await testDatabase.pool.query(
        "delete from discount_applications where workspace_reservation_id = any($1)",
        [reservationIds]
      );
      await testDatabase.pool.query(
        "delete from payment_attempts where workspace_reservation_id = any($1)",
        [reservationIds]
      );
      await testDatabase.pool.query(
        "delete from workspace_reservations where id = any($1)",
        [reservationIds]
      );
      await testDatabase.pool.query(
        "delete from promotion_codes where id in (select promotion_code_id from discount_codes where discount_id = any($1))",
        [discountIds]
      );
      await testDatabase.pool.query(
        "delete from discounts where id = any($1)",
        [discountIds]
      );
    });

    const runResult = <A, E>(
      operation: (
        repository: typeof PaymentLifecycleRepository.Service
      ) => Effect.Effect<A, E>
    ) =>
      Effect.runPromise(
        Effect.gen(function* () {
          return yield* operation(yield* PaymentLifecycleRepository);
        }).pipe(
          Effect.provide(PaymentLifecycleRepository.Default),
          Effect.provide(testDatabase.layer),
          Effect.provide(referralFeatureFlag(true)),
          Effect.result
        )
      );

    /** Inserts a synthetic held reservation that has not started payment. */
    const insertHeldReservation = async () => {
      const id = crypto.randomUUID();
      const dotyposReservationId = DotyposReservationIdSchema.make(
        `dotypos-${id}`
      );
      const { id: reservationId, dotyposCustomerId } = await Effect.runPromise(
        workspaceFixtures(testDatabase.db).reservation({
          stage: { reservation: "held" },
          overrides: { dotyposReservationId },
        })
      );
      reservationIds.push(reservationId);
      return { id, reservationId, dotyposCustomerId, dotyposReservationId };
    };

    const makeSnapshot = (reservation: {
      readonly reservationId: WorkspaceReservationId;
      readonly dotyposCustomerId: string;
      readonly dotyposReservationId: string;
    }): AccountingDocumentSnapshot => {
      const {
        fulfilledAt: _fulfilledAt,
        invoiceNumber: _invoiceNumber,
        issuedAt: _issuedAt,
        paidAt: _paidAt,
        paymentAttemptId: _paymentAttemptId,
        supplier: invoiceSupplier,
        ...identity
      } = makeCoworkInvoiceDocument("en-US");
      const { commercialRegister: _commercialRegister, ...supplier } =
        invoiceSupplier;

      return Schema.decodeUnknownSync(accountingDocumentSnapshotSchema)({
        ...identity,
        workspaceReservationId: reservation.reservationId,
        dotyposCustomerId: reservation.dotyposCustomerId,
        dotyposReservationId: reservation.dotyposReservationId,
        supplier,
        billing: { purpose: "personal", invoice: "none" },
        delivery: { email: testEmailAddress("synthetic") },
      });
    };

    const createPendingNexiAttempt = (input: {
      readonly reservationId: WorkspaceReservationId;
      readonly id: string;
      readonly snapshot: AccountingDocumentSnapshot;
      readonly commitment: DiscountCommitment;
    }) =>
      runResult((repository) =>
        repository.createPendingNexiAttempt({
          workspaceReservationId: input.reservationId,
          providerOrderId: NexiOrderIdSchema.make(`order-${input.id}`),
          amount: input.snapshot.quote.payment.expectedPrice,
          commitment: input.commitment,
          locale: "en-US",
          accountingSnapshot: input.snapshot,
        })
      );

    const readRows = async (reservationId: WorkspaceReservationId) => {
      const [reservation] = await Effect.runPromise(
        testDatabase.db
          .select()
          .from(workspaceReservations)
          .where(eq(workspaceReservations.id, reservationId))
      );
      const attempts = await Effect.runPromise(
        testDatabase.db
          .select()
          .from(paymentAttempts)
          .where(eq(paymentAttempts.workspaceReservationId, reservationId))
      );
      const snapshots = await Effect.runPromise(
        testDatabase.db
          .select({
            paymentAttemptId: accountingDocumentSnapshots.paymentAttemptId,
          })
          .from(accountingDocumentSnapshots)
          .where(
            eq(
              accountingDocumentSnapshots.workspaceReservationId,
              reservationId
            )
          )
      );
      const applications = await Effect.runPromise(
        testDatabase.db
          .select({ id: discountApplications.id })
          .from(discountApplications)
          .where(eq(discountApplications.workspaceReservationId, reservationId))
      );
      return { reservation, attempts, snapshots, applications };
    };

    /** Inserts a synthetic enabled, unrestricted discount code for the products. */
    const insertDiscountCode = async (
      products: readonly [WorkspaceProductTarget, ...WorkspaceProductTarget[]]
    ) => {
      const storedDiscountId = storedDiscountIdSchema.make(crypto.randomUUID());
      const codeId = discountCodeIdSchema.make(crypto.randomUUID());
      const promotionCodeId = promotionCodeIdSchema.make(codeId);
      const code = canonicalPromotionCodeSchema.make(
        `TIER-${codeId.slice(0, 8).toUpperCase()}`
      );
      discountIds.push(storedDiscountId);
      await Effect.runPromise(
        Effect.flatMap(WorkspaceDatabase, ({ db, transaction }) =>
          transaction(
            Effect.gen(function* () {
              yield* db.insert(discounts).values({
                id: storedDiscountId,
                labels: { "cs-CZ": "Tarifní sleva", "en-US": "Tier discount" },
                percentageBasisPoints: 1000,
              });
              yield* db.insert(discountProductTargets).values(
                products.map((productTarget) => ({
                  discountId: storedDiscountId,
                  productTarget,
                }))
              );
              yield* db.insert(promotionCodes).values({
                id: promotionCodeId,
                kind: "discount",
                code,
                enabled: true,
              });
              yield* db.insert(discountCodes).values({
                id: codeId,
                code,
                enabled: true,
                promotionCodeId,
                discountId: storedDiscountId,
              });
            })
          )
        ).pipe(Effect.provide(testDatabase.layer))
      );
      return { codeId, storedDiscountId };
    };

    const claimTierDiscountCode = async (input: {
      readonly products: readonly [
        WorkspaceProductTarget,
        ...WorkspaceProductTarget[],
      ];
      readonly product: {
        readonly kind: "cowork";
        readonly tier: "open-space" | "reserved-desk";
      };
    }) => {
      const reservation = await insertHeldReservation();
      const { codeId, storedDiscountId } = await insertDiscountCode(
        input.products
      );
      const snapshot = makeSnapshot(reservation);
      const discount = {
        id: Schema.decodeUnknownSync(discountIdSchema)(`code-${codeId}`),
        label: "Tier discount",
        adjustment: { kind: "percentage" as const, basisPoints: 1000 },
      };
      const subtotalBefore = snapshot.quote.payment.expectedPrice;
      const amount = { ...subtotalBefore, value: subtotalBefore.value / 10 };

      return createPendingNexiAttempt({
        ...reservation,
        snapshot,
        commitment: makeDiscountCommitment({
          product: input.product,
          applications: [
            {
              application: {
                discount,
                subtotalBefore,
                amount,
                subtotalAfter: {
                  ...subtotalBefore,
                  value: subtotalBefore.value - amount.value,
                },
              },
              candidate: {
                discount,
                provenance: {
                  providerNamespace: "synthetic",
                  providerReference: "synthetic",
                },
                claim: {
                  kind: "discount_code",
                  codeId,
                  storedDiscountId,
                  dotyposCustomerId: reservation.dotyposCustomerId,
                  product: input.product,
                },
              },
            },
          ],
        }),
      });
    };

    test("claims a discount code through a broad or matching cowork tier target", async () => {
      const broad = await claimTierDiscountCode({
        products: [{ kind: "cowork" }],
        product: { kind: "cowork", tier: "open-space" },
      });
      const tier = await claimTierDiscountCode({
        products: [{ kind: "cowork", tier: "reserved-desk" }],
        product: { kind: "cowork", tier: "reserved-desk" },
      });

      expect(broad._tag).toBe("Success");
      expect(tier._tag).toBe("Success");
    });

    test("refuses a discount code claim for a cowork tier its targets omit", async () => {
      const result = await claimTierDiscountCode({
        products: [{ kind: "cowork", tier: "reserved-desk" }],
        product: { kind: "cowork", tier: "open-space" },
      });

      expect(result).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "DiscountClaimError", reason: "product_ineligible" },
      });
    });

    test("admits the attempt, its accounting snapshot, and the reservation link together", async () => {
      const reservation = await insertHeldReservation();

      const result = await createPendingNexiAttempt({
        ...reservation,
        snapshot: makeSnapshot(reservation),
        commitment: makeDiscountCommitment({
          product: { kind: "cowork", tier: "basic" },
          applications: [],
        }),
      });

      expect(result._tag).toBe("Success");
      const rows = await readRows(reservation.reservationId);
      expect(rows.attempts).toHaveLength(1);
      const attemptId = rows.attempts[0]?.id;
      expect(rows.attempts[0]?.state).toBe("created");
      expect(rows.snapshots).toEqual([{ paymentAttemptId: attemptId }]);
      expect(rows.reservation?.activePaymentAttemptId).toBe(attemptId);
      expect(rows.reservation?.paymentState).toBe("pending");
    });

    test("rolls back the attempt, snapshot, and link when the discount claim is refused", async () => {
      const reservation = await insertHeldReservation();
      const snapshot = makeSnapshot(reservation);
      const discount = {
        id: Schema.decodeUnknownSync(discountIdSchema)("public-discount"),
        label: "Synthetic discount",
        adjustment: { kind: "percentage" as const, basisPoints: 1000 },
      };
      const subtotalBefore = snapshot.quote.payment.expectedPrice;
      const amount = { ...subtotalBefore, value: subtotalBefore.value / 10 };
      const product = { kind: "cowork", tier: "basic" } as const;

      const result = await createPendingNexiAttempt({
        ...reservation,
        snapshot,
        commitment: makeDiscountCommitment({
          product,
          applications: [
            {
              application: {
                discount,
                subtotalBefore,
                amount,
                subtotalAfter: {
                  ...subtotalBefore,
                  value: subtotalBefore.value - amount.value,
                },
              },
              candidate: {
                discount,
                provenance: {
                  providerNamespace: "synthetic",
                  providerReference: "synthetic",
                },
                // The claim names another customer, which the claim admission
                // refuses after the attempt rows are written.
                claim: {
                  kind: "discount_code",
                  codeId: discountCodeIdSchema.make(`code-${reservation.id}`),
                  storedDiscountId: storedDiscountIdSchema.make(
                    crypto.randomUUID()
                  ),
                  dotyposCustomerId: DotyposCustomerIdSchema.make(
                    `other-customer-${reservation.id}`
                  ),
                  product,
                },
              },
            },
          ],
        }),
      });

      expect(result).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "DiscountClaimError", reason: "customer_ineligible" },
      });
      const rows = await readRows(reservation.reservationId);
      expect(rows.attempts).toEqual([]);
      expect(rows.snapshots).toEqual([]);
      expect(rows.applications).toEqual([]);
      expect(rows.reservation?.activePaymentAttemptId).toBeNull();
      expect(rows.reservation?.paymentState).toBe("not_started");
    });

    /**
     * Seeds a voucher whose earlier claim by the customer, on another
     * checkout, has been released.
     */
    const seedReleasedVoucherClaim = async (customerId: DotyposCustomerId) => {
      const id = crypto.randomUUID();
      const voucherId = voucherIdSchema.make(`lifecycle-voucher-${id}`);
      voucherIds.push(voucherId);
      const { id: reservationId } = await Effect.runPromise(
        workspaceFixtures(testDatabase.db).reservation({
          stage: { reservation: "cancelled", payment: "expired" },
          customer: customerId,
        })
      );
      reservationIds.push(reservationId);
      await testDatabase.pool.query(
        `insert into payment_attempts (id, workspace_reservation_id, provider, provider_order_id, state, failure_code, refund_state, amount_value, amount_exponent, currency)
         values ($1, $1, 'nexi', $1, 'expired', 'payment_abandoned_after_provider_cutoff', 'not_required', 29000, 2, 'CZK')`,
        [reservationId]
      );
      await testDatabase.pool.query(
        `insert into discount_applications (id, payment_attempt_id, workspace_reservation_id, sequence, public_discount_id, label, adjustment, product_identity, subtotal_before_value, subtotal_before_exponent, subtotal_before_currency, applied_amount_value, applied_amount_exponent, applied_amount_currency, subtotal_after_value, subtotal_after_exponent, subtotal_after_currency, provenance)
         values ($1, $1, $1, 0, 'synthetic-discount', 'Synthetic', '{}', '{}', 29000, 2, 'CZK', 1000, 2, 'CZK', 28000, 2, 'CZK', '{}')`,
        [reservationId]
      );
      await testDatabase.pool.query(
        `insert into promotion_codes (id, kind, code, enabled)
         values ($1, 'voucher', $2, true)`,
        [voucherId, `SYNTHETIC_${id.replaceAll("-", "_").toUpperCase()}`]
      );
      await testDatabase.pool.query(
        `insert into vouchers (id, promotion_code_id, issued_amount_value, issued_amount_exponent, issued_amount_currency)
         values ($1, $1, 1000, 2, 'CZK')`,
        [voucherId]
      );
      await testDatabase.pool.query(
        `insert into voucher_redemptions (id, voucher_id, application_id, payment_attempt_id, dotypos_customer_id, state, reservation_expires_at, released_at, release_reason)
         values ($1, $1, $2, $2, $3, 'released', now() + interval '1 hour', now(), 'expired')`,
        [voucherId, reservationId, customerId]
      );
      return voucherId;
    };

    test("reports an active voucher claim that wins the race as a claim conflict", async () => {
      const reservation = await insertHeldReservation();
      const voucherId = await seedReleasedVoucherClaim(
        reservation.dotyposCustomerId
      );
      const snapshot = makeSnapshot(reservation);
      const subtotalBefore = snapshot.quote.payment.expectedPrice;
      const voucherCredit = { ...subtotalBefore, value: 1000 };
      const provenance = {
        providerNamespace: "database-voucher",
        providerReference: voucherId,
      };
      const discount = {
        id: deriveOpaqueDiscountId(provenance),
        label: m.checkoutVoucherLabel({}, { locale: "en-US" }),
        adjustment: { kind: "fixed" as const, amount: voucherCredit },
      };

      // Another checkout re-activates the customer's claim but has not
      // committed, so this attempt's claim checks still see it released and
      // only the active-claim unique index stops the second claim.
      const competingCheckout = await testDatabase.pool.connect();
      try {
        await competingCheckout.query("begin");
        await competingCheckout.query(
          "update voucher_redemptions set state = 'reserved', released_at = null, release_reason = null where voucher_id = $1",
          [voucherId]
        );

        const attempt = createPendingNexiAttempt({
          ...reservation,
          snapshot,
          commitment: makeDiscountCommitment({
            product: { kind: "cowork", tier: "basic" },
            applications: [
              {
                application: {
                  discount,
                  subtotalBefore,
                  amount: voucherCredit,
                  subtotalAfter: {
                    ...subtotalBefore,
                    value: subtotalBefore.value - voucherCredit.value,
                  },
                },
                candidate: {
                  discount,
                  provenance,
                  claim: {
                    kind: "voucher",
                    voucherId,
                    availableAmount: voucherCredit,
                    dotyposCustomerId: reservation.dotyposCustomerId,
                  },
                },
              },
            ],
          }),
        });
        await waitForPostgresLockWaiter(testDatabase.pool, {
          condition: "locktype = 'transactionid'",
          description: "the second voucher claim waiting on the first",
        });
        await competingCheckout.query("commit");

        expect(await attempt).toMatchObject({
          _tag: "Failure",
          failure: {
            _tag: "DiscountClaimError",
            operation: "reserve",
            reason: "claim_conflict",
          },
        });
      } finally {
        await competingCheckout.query("rollback").catch(() => {});
        competingCheckout.release();
      }

      const rows = await readRows(reservation.reservationId);
      expect(rows.attempts).toEqual([]);
      expect(rows.snapshots).toEqual([]);
      expect(rows.applications).toEqual([]);
      expect(rows.reservation?.activePaymentAttemptId).toBeNull();
      expect(rows.reservation?.paymentState).toBe("not_started");
    });
  }
);
