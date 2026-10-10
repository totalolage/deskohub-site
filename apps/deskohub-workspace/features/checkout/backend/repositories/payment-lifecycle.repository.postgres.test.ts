import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import type {
  DotyposCustomerId,
  DotyposReservationId,
} from "@deskohub/dotypos";
import { DotyposService } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { makeDatabaseClient, makeDatabasePool } from "@/db/database-client";
import { databasePoolTimeouts } from "@/db/database-pool-timeouts";
import { WorkspaceDatabaseAdvisoryLock } from "@/db/postgres-advisory-lock";
import {
  discountCodes,
  discountProductTargets,
  discounts,
  promotionCodes,
  referralAttributions,
  referralCodes,
  vouchers,
  workspaceReservations,
} from "@/db/schema";
import { CustomerAccountLinkRepository } from "@/features/account/backend/customer-account-link.repository";
import { CustomerAccountResolver } from "@/features/account/backend/customer-account-resolver.service";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import { makeAccountingDocumentSnapshot } from "@/features/accounting/accounting-document-snapshot";
import type { PreparedCustomerQuote } from "@/features/checkout/backend/checkout/checkout-pricing.service";
import { LatePaymentRecoveryRepository } from "@/features/checkout/backend/repositories/late-payment-recovery.repository";
import {
  type IPaymentLifecycleRepository,
  PaymentLifecycleRepository,
} from "@/features/checkout/backend/repositories/payment-lifecycle.repository";
import { buildCoworkReservationQuote } from "@/features/checkout/reservation-quote-cowork";
import type { WorkspaceMoney } from "@/features/checkout/workspace-money";
import { calculateDiscounts } from "@/features/discounts/calculator";
import {
  type DiscountCommitment,
  getDiscountCommitmentPayload,
  makeDiscountCommitment,
} from "@/features/discounts/commitment";
import type { DiscountQuote } from "@/features/discounts/contracts";
import { deriveOpaqueDiscountId } from "@/features/discounts/opaque-discount-id";
import {
  canonicalPromotionCodeSchema,
  promotionCodeIdSchema,
} from "@/features/discounts/persistence-contracts";
import { getWorkspaceProductTarget } from "@/features/discounts/product-target";
import type { DiscountCandidate } from "@/features/discounts/provider";
import { type Locale, m } from "@/features/i18n";
import { getReferralInvitationDiscountId } from "@/features/referrals/discount-identifiers";
import { ReferralService } from "@/features/referrals/referral.service";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";

const testDatabase = await connectWorkspacePostgresTestDatabase();
const product = { kind: "cowork", tier: "basic" } as const;
const reservationDetails = {
  kind: "cowork",
  entryTier: "basic",
  coffee: false,
} as const;
const uniqueId = () => crypto.randomUUID();
const customerId = () =>
  (
    Math.floor(Math.random() * 900_000_000) + 100_000_000
  ).toString() as DotyposCustomerId;

type Reservation = typeof workspaceReservations.$inferSelect;
type Admission = {
  readonly amount: WorkspaceMoney;
  readonly commitment: DiscountCommitment;
};

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
              databaseLayer,
              lockLayer,
              accountLinksLayer,
              Layer.succeed(CustomerAccountResolver, {
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
    "RFL" + crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()
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

const createHeldReservation = async (
  dotyposCustomerId: DotyposCustomerId
): Promise<Reservation> => {
  const [reservation] = await Effect.runPromise(
    testDatabase!.db
      .insert(workspaceReservations)
      .values({
        checkoutAttemptKey: "referral-payment-" + uniqueId(),
        dotyposCustomerId,
        dotyposReservationId: ("dotypos-" + uniqueId()) as DotyposReservationId,
        reservationState: "held",
        paymentState: "not_started",
        fulfillmentState: "not_started",
        reservationDetails,
        locale: "en-US",
        reservationHoldExpiresAt: Temporal.Now.instant().add({ hours: 1 }),
      })
      .returning()
  );
  return reservation!;
};

const createOrdinaryDiscountCode = async (
  dotyposCustomerId: DotyposCustomerId
) => {
  const code = canonicalPromotionCodeSchema.make(
    "D" + uniqueId().replaceAll("-", "").slice(0, 12).toUpperCase()
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
      productTarget: getWorkspaceProductTarget(product),
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
    "V" + uniqueId().replaceAll("-", "").slice(0, 12).toUpperCase()
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
      email: "synthetic@example.test",
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
    providerOrderId: ("order-" + uniqueId()) as never,
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
              testDatabase!.db.insert(workspaceReservations).values({
                checkoutAttemptKey: "referral-history-" + uniqueId(),
                dotyposCustomerId: fixture.invitedDotyposCustomerId,
                dotyposReservationId: ("dotypos-history-" +
                  uniqueId()) as DotyposReservationId,
                reservationState: "confirmed",
                paymentState: "paid",
                paidAt: Temporal.Now.instant(),
                fulfillmentState: "not_started",
                reservationDetails,
                locale: "en-US",
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
            webhookEventId: ("webhook-" + uniqueId()) as never,
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
            webhookEventId: ("webhook-" + uniqueId()) as never,
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
          await testDatabase!.pool.query(
            `insert into auth."user" (id, name, email) values ($1, '', $2), ($3, '', $4)`,
            [
              inviteeAccountId,
              `${inviteeAccountId}@deskohub.test`,
              referrerAccountId,
              `${referrerAccountId}@deskohub.test`,
            ]
          );
          await testDatabase!.pool.query(
            "insert into customer_account_links (customer_account_id, dotypos_customer_id) values ($1, $2), ($3, $4)",
            [
              inviteeAccountId,
              fixture.invitedDotyposCustomerId,
              referrerAccountId,
              fixture.referrerDotyposCustomerId,
            ]
          );

          const db = await Effect.runPromise(makeDatabaseClient(pool));
          const databaseLayer = Layer.succeed(
            WorkspaceDatabase,
            WorkspaceDatabase.of({ db })
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
            "delete from customer_account_links where customer_account_id = any($1)",
            [[inviteeAccountId, referrerAccountId]]
          );
          await testDatabase!.pool.query(
            'delete from auth."user" where id = any($1)',
            [[inviteeAccountId, referrerAccountId]]
          );
          await pool.end();
        }
      });
    }
  }
);
