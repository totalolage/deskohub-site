import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import type { DotyposCustomerId } from "@deskohub/dotypos";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer, Schema } from "effect";
import type { WorkspaceReservationRow } from "@/db/schema";
import {
  discountCodes,
  discountProductTargets,
  discounts,
  promotionCodeCustomers,
  promotionCodes,
  referralAttributions,
  referralCodes,
  vouchers,
} from "@/db/schema";
import { makeAccountingDocumentSnapshot } from "@/features/accounting/accounting-document-snapshot";
import type { PreparedCustomerQuote } from "@/features/checkout/backend/checkout/checkout-pricing.service";
import type { PaymentAttemptId } from "@/features/checkout/checkout-identifiers";
import { buildCoworkReservationQuote } from "@/features/checkout/reservation-quote-cowork";
import { calculateDiscounts } from "@/features/discounts/calculator";
import { makeDiscountCommitment } from "@/features/discounts/commitment";
import { discountIdSchema } from "@/features/discounts/contracts";
import { deriveOpaqueDiscountId } from "@/features/discounts/opaque-discount-id";
import {
  canonicalPromotionCodeSchema,
  promotionCodeIdSchema,
} from "@/features/discounts/persistence-contracts";
import { getWorkspaceProductTargetsCovering } from "@/features/discounts/product-target";
import type { DiscountCandidate } from "@/features/discounts/provider";
import { type Locale, m } from "@/features/i18n";
import { getReferralBenefitIds } from "@/features/referrals/referral-benefits";
import type { Money } from "@/shared/money/money";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { LatePaymentRecoveryRepository } from "./late-payment-recovery.repository";
import {
  type IPaymentLifecycleRepository,
  PaymentLifecycleRepository,
} from "./payment-lifecycle.repository";

const testDatabase = await connectWorkspacePostgresTestDatabase();
const product = { kind: "cowork", tier: "basic" } as const;
const locale: Locale = "en-US";
const uniqueSuffix = () =>
  crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
const customerId = () =>
  (
    Math.floor(Math.random() * 900_000_000) + 100_000_000
  ).toString() as DotyposCustomerId;
const czk = (value: number): Money => ({ value, exponent: 2, currency: "CZK" });

describe.skipIf(!testDatabase)(
  "PaymentLifecycleRepository outcomes on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const customers: DotyposCustomerId[] = [];
    const promotionIds: string[] = [];
    const discountIds: string[] = [];

    // Mirrors the lifecycle suite's cleanup: accounting snapshots of internal
    // (paid) attempts are immutable, so those rows and their reservations stay.
    afterAll(async () => {
      const query = (text: string, values: readonly unknown[]) =>
        testDatabase.pool.query(text, [...values]);
      const reservationsOf =
        "select id from workspace_reservations where dotypos_customer_id = any($1)";
      const nexiAttemptsOf = `select id from payment_attempts where provider <> 'internal' and workspace_reservation_id in (${reservationsOf})`;
      for (const table of [
        "referral_invitation_claims",
        "discount_code_redemptions",
        "voucher_redemptions",
      ]) {
        await query(
          `delete from ${table} where payment_attempt_id in (${nexiAttemptsOf})`,
          [customers]
        );
      }
      await query(
        `update payment_attempts set state = 'failed', refund_state = 'not_required', failure_code = 'outcome_test_cleanup' where id in (${nexiAttemptsOf})`,
        [customers]
      );
      await query(
        `delete from accounting_document_snapshots where payment_attempt_id in (${nexiAttemptsOf})`,
        [customers]
      );
      await query(
        `delete from late_payment_recoveries where workspace_reservation_id in (${reservationsOf})`,
        [customers]
      );
      await query(
        `delete from discount_applications where payment_attempt_id in (${nexiAttemptsOf})`,
        [customers]
      );
      await query(
        `update workspace_reservations set active_payment_attempt_id = null where active_payment_attempt_id in (${nexiAttemptsOf})`,
        [customers]
      );
      await query(
        `delete from payment_attempts where id in (${nexiAttemptsOf})`,
        [customers]
      );
      await query(
        "delete from customer_events where dotypos_customer_id = any($1)",
        [customers]
      );
      await query(
        "delete from workspace_reservations reservation where dotypos_customer_id = any($1) and not exists (select 1 from payment_attempts where workspace_reservation_id = reservation.id)",
        [customers]
      );
      await query(
        "delete from referral_attributions where invited_dotypos_customer_id = any($1)",
        [customers]
      );
      // A promotion an internal payment redeemed stays referenced.
      for (const id of promotionIds) {
        await query(
          "delete from promotion_codes promotion where id = $1 and not exists (select 1 from vouchers voucher join voucher_redemptions redemption on redemption.voucher_id = voucher.id where voucher.promotion_code_id = promotion.id) and not exists (select 1 from referral_invitation_claims claim where claim.promotion_code_id = promotion.id)",
          [id]
        );
      }
      await query(
        "delete from discount_product_targets target where discount_id = any($1) and not exists (select 1 from discount_codes code where code.discount_id = target.discount_id)",
        [discountIds]
      );
      await query(
        "delete from discounts discount where id = any($1) and not exists (select 1 from discount_codes code where code.discount_id = discount.id)",
        [discountIds]
      );
    });

    const repositoryLayer = PaymentLifecycleRepository.Default.pipe(
      Layer.provide(testDatabase.layer)
    );
    const lateRecoveryLayer = LatePaymentRecoveryRepository.Default.pipe(
      Layer.provide(testDatabase.layer)
    );

    /** Runs one lifecycle operation and returns its exit as a result. */
    const lifecycle = <A, E>(
      operation: (
        repository: IPaymentLifecycleRepository
      ) => Effect.Effect<A, E>
    ) =>
      Effect.runPromise(
        Effect.gen(function* () {
          return yield* operation(yield* PaymentLifecycleRepository);
        }).pipe(Effect.provide(repositoryLayer), Effect.result)
      );

    const lateRecovery = <A, E>(
      operation: (
        repository: typeof LatePaymentRecoveryRepository.Service
      ) => Effect.Effect<A, E>
    ) =>
      Effect.runPromise(
        Effect.gen(function* () {
          return yield* operation(yield* LatePaymentRecoveryRepository);
        }).pipe(Effect.provide(lateRecoveryLayer), Effect.result)
      );

    const succeed = async <A, E>(
      result: Promise<
        { _tag: "Success"; success: A } | { _tag: "Failure"; failure: E }
      >
    ) => {
      const settled = await result;
      if (settled._tag === "Failure") {
        throw new Error(`Expected success, failed with ${settled.failure}`);
      }
      return settled.success;
    };

    const newCustomer = () => {
      const customer = customerId();
      customers.push(customer);
      return customer;
    };

    const heldReservation = (customer: DotyposCustomerId) =>
      Effect.runPromise(
        workspaceFixtures(testDatabase.db).reservation({
          stage: { reservation: "held" },
          customer,
        })
      );

    const sql = async (text: string, values: readonly unknown[]) =>
      (await testDatabase.pool.query(text, [...values])).rows;

    const insertPromotion = async (
      kind: "discount" | "voucher" | "referral"
    ) => {
      const [promotion] = await Effect.runPromise(
        testDatabase.db
          .insert(promotionCodes)
          .values({
            kind,
            code: canonicalPromotionCodeSchema.make(
              `${kind[0]!.toUpperCase()}${uniqueSuffix()}`
            ),
            enabled: true,
          })
          .returning({ id: promotionCodes.id })
      );
      promotionIds.push(promotion!.id);
      return promotion!.id;
    };

    /** A stored 10% cowork discount code claimed by `customer`. */
    const createDiscountCode = async (
      customer: DotyposCustomerId,
      limits: {
        readonly maxUses?: number | null;
        readonly maxUsesPerCustomer?: number | null;
      } = {}
    ) => {
      const labels = { "en-US": "Outcome campaign", "cs-CZ": "Kampaň" };
      const promotionId = await insertPromotion("discount");
      const [storedDiscount] = await Effect.runPromise(
        testDatabase.db
          .insert(discounts)
          .values({ labels, percentageBasisPoints: 1_000 })
          .returning({ id: discounts.id })
      );
      discountIds.push(storedDiscount!.id);
      await Effect.runPromise(
        testDatabase.db.insert(discountProductTargets).values({
          discountId: storedDiscount!.id,
          productTarget: getWorkspaceProductTargetsCovering(product)[0],
        })
      );
      const [code] = await Effect.runPromise(
        testDatabase.db
          .insert(discountCodes)
          .values({
            code: canonicalPromotionCodeSchema.make(`D${uniqueSuffix()}`),
            enabled: true,
            promotionCodeId: promotionId,
            discountId: storedDiscount!.id,
            maxUses: limits.maxUses ?? null,
            maxUsesPerCustomer: limits.maxUsesPerCustomer ?? null,
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
          providerReference: code!.id,
          details: {
            discountCodeId: code!.id,
            storedDiscountId: storedDiscount!.id,
          },
        },
        claim: {
          kind: "discount_code",
          codeId: code!.id,
          storedDiscountId: storedDiscount!.id,
          dotyposCustomerId: customer,
          product,
        },
      };
      return { candidate, codeId: code!.id, promotionId };
    };

    /** Voucher credit `amount` claimed by `customer`, offered as `available`. */
    const createVoucher = async (
      customer: DotyposCustomerId,
      amount: number
    ) => {
      const promotionId = await insertPromotion("voucher");
      const [voucher] = await Effect.runPromise(
        testDatabase.db
          .insert(vouchers)
          .values({
            promotionCodeId: promotionId,
            issuedAmountValue: amount,
            issuedAmountExponent: 2,
            issuedAmountCurrency: "CZK",
          })
          .returning({ id: vouchers.id })
      );
      const offer = (available: number): DiscountCandidate => ({
        discount: {
          id: deriveOpaqueDiscountId({
            providerNamespace: "database-voucher",
            providerReference: voucher!.id,
          }),
          label: m.checkoutVoucherLabel({}, { locale }),
          adjustment: { kind: "fixed", amount: czk(available) },
        },
        provenance: {
          providerNamespace: "database-voucher",
          providerReference: voucher!.id,
          details: { voucherId: voucher!.id },
        },
        claim: {
          kind: "voucher",
          voucherId: voucher!.id,
          availableAmount: czk(available),
          dotyposCustomerId: customer,
        },
      });
      return { offer, voucherId: voucher!.id, promotionId };
    };

    /** A referral code and, unless withheld, the invitee's attribution. */
    const createReferral = async (invited: DotyposCustomerId) => {
      const referrer = newCustomer();
      const promotionId = await insertPromotion("referral");
      await Effect.runPromise(
        testDatabase.db.insert(referralCodes).values({
          promotionCodeId: promotionId,
          referrerDotyposCustomerId: referrer,
        })
      );
      const invitation = (
        overrides: {
          readonly invitedDotyposCustomerId?: DotyposCustomerId;
          readonly referrerDotyposCustomerId?: DotyposCustomerId;
        } = {}
      ): DiscountCandidate => {
        const invitedDotyposCustomerId =
          overrides.invitedDotyposCustomerId ?? invited;
        const referrerDotyposCustomerId =
          overrides.referrerDotyposCustomerId ?? referrer;
        const promotionCodeId = promotionCodeIdSchema.make(promotionId);
        return {
          discount: {
            id: getReferralBenefitIds(invitedDotyposCustomerId).invitation,
            label: m.checkoutSummaryItemReferralInvitationDiscount(
              {},
              { locale }
            ),
            adjustment: { kind: "percentage", basisPoints: 1_500 },
          },
          provenance: {
            providerNamespace: "referral-invitation",
            providerReference: promotionId,
            details: {
              referralInvitation: {
                invitedDotyposCustomerId,
                referrerDotyposCustomerId,
                promotionCodeId,
              },
            },
          },
          claim: {
            kind: "referral_invitation",
            invitedDotyposCustomerId,
            referrerDotyposCustomerId,
            promotionCodeId,
          },
        };
      };
      return { referrer, promotionId, invitation };
    };

    const fullUnclaimedDiscount: DiscountCandidate = {
      discount: {
        id: Schema.decodeUnknownSync(discountIdSchema)("outcome-full-discount"),
        label: "Synthetic full discount",
        adjustment: { kind: "percentage", basisPoints: 10_000 },
      },
      provenance: { providerNamespace: "synthetic", providerReference: "full" },
    };

    /** Prices `candidates` in order and seals the matching snapshot. */
    const admission = (
      reservation: WorkspaceReservationRow,
      candidates: readonly DiscountCandidate[] = []
    ) => {
      const baseQuote = Effect.runSync(
        buildCoworkReservationQuote({
          kind: "cowork",
          entryTier: "basic",
          coffee: false,
        })
      );
      const calculation = Effect.runSync(
        calculateDiscounts({
          product,
          discountableSubtotal: baseQuote.payment.expectedPrice,
          candidates,
        })
      );
      const quote = Effect.runSync(
        buildCoworkReservationQuote(
          { kind: "cowork", entryTier: "basic", coffee: false },
          candidates.length > 0 ? { discountQuote: calculation.quote } : {}
        )
      );
      const accountingSnapshot = makeAccountingDocumentSnapshot({
        workspaceReservationId: reservation.id,
        dotyposReservationId: reservation.dotyposReservationId!,
        dotyposCustomerId: reservation.dotyposCustomerId as DotyposCustomerId,
        locale,
        prepared: {
          kind: "cowork",
          reservation: {
            kind: "cowork",
            entryTier: "basic",
            coffee: false,
            date: "2099-01-01",
            name: "Synthetic Customer",
            email: testEmailAddress("synthetic"),
            phone: "+420 700 000 000",
          },
          quote,
        } as PreparedCustomerQuote,
      });
      return {
        workspaceReservationId: reservation.id,
        amount: accountingSnapshot.quote.payment.expectedPrice,
        commitment: makeDiscountCommitment({
          product,
          firstServiceDate: "2099-01-01",
          applications: calculation.applications,
        }),
        locale,
        accountingSnapshot,
      };
    };

    const admit = (
      reservation: WorkspaceReservationRow,
      candidates: readonly DiscountCandidate[] = []
    ) =>
      lifecycle((repository) =>
        repository.createPendingNexiAttempt({
          ...admission(reservation, candidates),
          providerOrderId: `order-${crypto.randomUUID()}` as never,
        })
      );

    const markPaid = (
      reservation: WorkspaceReservationRow,
      id: PaymentAttemptId,
      paidAt = Temporal.Now.instant()
    ) =>
      lifecycle((repository) =>
        repository.markPaid({
          id,
          workspaceReservationId: reservation.id,
          paidAt,
        })
      );

    const expire = (
      reservation: WorkspaceReservationRow,
      id: PaymentAttemptId
    ) =>
      succeed(
        lifecycle((repository) =>
          repository.markTerminal({
            id,
            workspaceReservationId: reservation.id,
            state: "expired",
            failureCode: "outcome_test_expired",
          })
        )
      );

    /** Starts and claims a late-payment recovery, then recovers the hold. */
    const recoverLatePayment = async (
      reservation: WorkspaceReservationRow,
      id: PaymentAttemptId
    ) => {
      await succeed(
        lateRecovery((recoveries) =>
          recoveries.start({
            paymentAttemptId: id,
            workspaceReservationId: reservation.id,
            providerStatus: "EXECUTED",
            verifiedPaidAt: Temporal.Now.instant(),
          })
        )
      );
      await succeed(
        lateRecovery((recoveries) =>
          recoveries.claim({
            paymentAttemptId: id,
            staleProcessingBefore: Temporal.Now.instant(),
          })
        )
      );
      return lateRecovery((recoveries) =>
        recoveries.completeUsingOriginalReservation({
          paymentAttemptId: id,
          workspaceReservationId: reservation.id,
          reservationState: "confirmed",
          completedAt: Temporal.Now.instant(),
        })
      );
    };

    const claimState = async (table: string, id: PaymentAttemptId) =>
      (
        await sql(`select state from ${table} where payment_attempt_id = $1`, [
          id,
        ])
      ).map(({ state }) => state);

    /** Another booking of the customer, already paid. */
    const paidReservation = (customer: DotyposCustomerId) =>
      Effect.runPromise(
        workspaceFixtures(testDatabase.db).reservation({
          stage: { reservation: "confirmed", payment: "paid" },
          customer,
        })
      );

    const claimError = (reason: string, operation = "reserve") => ({
      _tag: "Failure",
      failure: { _tag: "DiscountClaimError", operation, reason },
    });

    const stateError = (operation: string) => ({
      _tag: "Failure",
      failure: {
        _tag: "PaymentLifecycleStateError",
        operation: `PaymentLifecycleRepository.${operation}`,
      },
    });

    describe("discount-code admission", () => {
      test("reserves a valid code once per customer and once in total", async () => {
        const customer = newCustomer();
        const other = newCustomer();
        const code = await createDiscountCode(customer, {
          maxUses: 2,
          maxUsesPerCustomer: 1,
        });
        const first = await heldReservation(customer);
        const attempt = await succeed(admit(first, [code.candidate]));

        const second = await heldReservation(customer);
        expect(await admit(second, [code.candidate])).toMatchObject(
          claimError("usage_limit_reached")
        );

        const othersCode = {
          ...code.candidate,
          claim: { ...code.candidate.claim!, dotyposCustomerId: other },
        } as DiscountCandidate;
        const otherReservation = await heldReservation(other);
        await succeed(admit(otherReservation, [othersCode]));
        const third = newCustomer();
        const thirdReservation = await heldReservation(third);
        expect(
          await admit(thirdReservation, [
            {
              ...code.candidate,
              claim: { ...code.candidate.claim!, dotyposCustomerId: third },
            } as DiscountCandidate,
          ])
        ).toMatchObject(claimError("usage_limit_reached"));
        expect(
          await claimState("discount_code_redemptions", attempt.id)
        ).toEqual(["reserved"]);
      });

      test("refuses a code claimed for another customer", async () => {
        const customer = newCustomer();
        const code = await createDiscountCode(newCustomer());
        const reservation = await heldReservation(customer);

        expect(await admit(reservation, [code.candidate])).toMatchObject(
          claimError("customer_ineligible")
        );
      });

      test("refuses a missing, disabled, unstarted, or ended promotion", async () => {
        const customer = newCustomer();
        const missing = await createDiscountCode(customer);
        await sql("delete from discount_codes where id = $1", [missing.codeId]);
        const disabled = await createDiscountCode(customer);
        await sql("update promotion_codes set enabled = false where id = $1", [
          disabled.promotionId,
        ]);
        const unstarted = await createDiscountCode(customer);
        await sql(
          "update promotion_codes set valid_from = now() + interval '1 day' where id = $1",
          [unstarted.promotionId]
        );
        const ended = await createDiscountCode(customer);
        await sql(
          "update promotion_codes set valid_until = now() - interval '1 day' where id = $1",
          [ended.promotionId]
        );

        for (const [code, reason] of [
          [missing, "unknown_code"],
          [disabled, "inactive"],
          [unstarted, "not_started"],
          [ended, "expired"],
        ] as const) {
          const reservation = await heldReservation(customer);
          expect(await admit(reservation, [code.candidate])).toMatchObject(
            claimError(reason)
          );
        }
      });

      test("refuses a code whose stored benefit changed", async () => {
        const customer = newCustomer();
        const code = await createDiscountCode(customer);
        const reservation = await heldReservation(customer);
        const otherBenefit = {
          ...code.candidate,
          claim: {
            ...code.candidate.claim!,
            storedDiscountId: crypto.randomUUID(),
          },
        } as DiscountCandidate;

        expect(await admit(reservation, [otherBenefit])).toMatchObject(
          claimError("unknown_code")
        );
      });

      test("admits only customers on a promotion's allowlist", async () => {
        const allowed = newCustomer();
        const excluded = newCustomer();
        const allowedCode = await createDiscountCode(allowed);
        await Effect.runPromise(
          testDatabase.db.insert(promotionCodeCustomers).values({
            promotionCodeId: allowedCode.promotionId,
            dotyposCustomerId: allowed,
          })
        );
        const excludedCandidate = {
          ...allowedCode.candidate,
          claim: {
            ...allowedCode.candidate.claim!,
            dotyposCustomerId: excluded,
          },
        } as DiscountCandidate;

        const admitted = await succeed(
          admit(await heldReservation(allowed), [allowedCode.candidate])
        );
        expect(
          await admit(await heldReservation(excluded), [excludedCandidate])
        ).toMatchObject(claimError("customer_ineligible"));
        expect(
          await claimState("discount_code_redemptions", admitted.id)
        ).toEqual(["reserved"]);
      });
    });

    describe("voucher admission", () => {
      test("refuses changed credit and a second active claim by the customer", async () => {
        const customer = newCustomer();
        const voucher = await createVoucher(customer, 10_000);
        const first = await succeed(
          admit(await heldReservation(customer), [voucher.offer(10_000)])
        );

        // The first claim used all of the offered credit.
        expect(
          await admit(await heldReservation(customer), [voucher.offer(10_000)])
        ).toMatchObject({
          failure: {
            reason: "claim_conflict",
            message: expect.stringContaining("credit changed"),
          },
        });
        // Topped up, the voucher has credit again, but the customer still
        // holds an active claim on it.
        await sql(
          "update vouchers set issued_amount_value = 20000 where id = $1",
          [voucher.voucherId]
        );
        expect(
          await admit(await heldReservation(customer), [voucher.offer(10_000)])
        ).toMatchObject({
          failure: {
            reason: "claim_conflict",
            message: expect.stringContaining("active claim"),
          },
        });
        expect(await claimState("voucher_redemptions", first.id)).toEqual([
          "reserved",
        ]);
      });

      test("refuses a voucher claimed for another customer", async () => {
        const voucher = await createVoucher(newCustomer(), 10_000);
        const customer = newCustomer();

        expect(
          await admit(await heldReservation(customer), [voucher.offer(10_000)])
        ).toMatchObject(claimError("customer_ineligible"));
      });
    });

    describe("referral invitation admission", () => {
      test("refuses an invitation for another customer or a self-referral", async () => {
        const customer = newCustomer();
        const referral = await createReferral(customer);

        expect(
          await admit(await heldReservation(customer), [
            referral.invitation({ invitedDotyposCustomerId: newCustomer() }),
          ])
        ).toMatchObject(claimError("customer_ineligible"));
        expect(
          await admit(await heldReservation(customer), [
            referral.invitation({ referrerDotyposCustomerId: customer }),
          ])
        ).toMatchObject(claimError("claim_conflict"));
      });

      test("an invited customer with a paid booking pays ordinarily, and their invitation is gone", async () => {
        const customer = newCustomer();
        const referral = await createReferral(customer);
        await Effect.runPromise(
          testDatabase.db.insert(referralAttributions).values({
            invitedDotyposCustomerId: customer,
            referrerDotyposCustomerId: referral.referrer,
            promotionCodeId: promotionCodeIdSchema.make(referral.promotionId),
          })
        );
        await paidReservation(customer);

        await succeed(admit(await heldReservation(customer)));
        expect(
          await admit(await heldReservation(customer), [referral.invitation()])
        ).toMatchObject(claimError("claim_conflict"));
      });
    });

    describe("internal payment", () => {
      test("completes a fully discounted payment once and repeats it unchanged", async () => {
        const customer = newCustomer();
        const reservation = await heldReservation(customer);
        const input = admission(reservation, [fullUnclaimedDiscount]);
        expect(input.amount.value).toBe(0);

        const first = await succeed(
          lifecycle((repository) => repository.completeInternalPayment(input))
        );
        const again = await succeed(
          lifecycle((repository) => repository.completeInternalPayment(input))
        );

        expect(first.changed).toBe(true);
        expect(again).toMatchObject({
          changed: false,
          attempt: { id: first.attempt.id, state: "paid" },
        });
        expect(again.timestamp.toString()).toBe(
          (
            await sql(
              "select paid_at::text as paid_at from workspace_reservations where id = $1",
              [reservation.id]
            )
          ).map(({ paid_at }) => Temporal.Instant.from(paid_at).toString())[0]!
        );
      });

      test("redeems a covering voucher without a referral", async () => {
        const customer = newCustomer();
        const voucher = await createVoucher(customer, 50_000);
        const reservation = await heldReservation(customer);
        const input = admission(reservation, [voucher.offer(50_000)]);

        const paid = await succeed(
          lifecycle((repository) => repository.completeInternalPayment(input))
        );

        expect(
          await claimState("voucher_redemptions", paid.attempt.id)
        ).toEqual(["redeemed"]);
        expect(
          await claimState("referral_invitation_claims", paid.attempt.id)
        ).toEqual([]);
      });

      test("refuses an unknown reservation, an expired hold, and a reservation paid otherwise", async () => {
        const customer = newCustomer();
        const reservation = await heldReservation(customer);
        const input = admission(reservation, [fullUnclaimedDiscount]);

        expect(
          await lifecycle((repository) =>
            repository.completeInternalPayment(
              admission({ ...reservation, id: crypto.randomUUID() as never }, [
                fullUnclaimedDiscount,
              ])
            )
          )
        ).toMatchObject(stateError("completeInternalPayment"));

        await sql(
          "update workspace_reservations set reservation_hold_expires_at = now() - interval '1 minute' where id = $1",
          [reservation.id]
        );
        expect(
          await lifecycle((repository) =>
            repository.completeInternalPayment(input)
          )
        ).toMatchObject(stateError("completeInternalPayment"));

        const paidByNexi = await heldReservation(customer);
        const nexi = await succeed(admit(paidByNexi));
        await succeed(markPaid(paidByNexi, nexi.id));
        expect(
          await lifecycle((repository) =>
            repository.completeInternalPayment(
              admission(paidByNexi, [fullUnclaimedDiscount])
            )
          )
        ).toMatchObject(stateError("completeInternalPayment"));
      });

      test("a repeat with another amount is refused", async () => {
        const customer = newCustomer();
        const reservation = await heldReservation(customer);
        const input = admission(reservation, [fullUnclaimedDiscount]);
        await succeed(
          lifecycle((repository) => repository.completeInternalPayment(input))
        );
        await sql(
          "update payment_attempts set currency = 'EUR' where workspace_reservation_id = $1",
          [reservation.id]
        );

        expect(
          await lifecycle((repository) =>
            repository.completeInternalPayment(input)
          )
        ).toMatchObject(stateError("completeInternalPayment"));
      });
    });

    describe("paid transition", () => {
      test("repeats as unchanged with the first paid time and redeems the code once", async () => {
        const customer = newCustomer();
        const code = await createDiscountCode(customer);
        const reservation = await heldReservation(customer);
        const attempt = await succeed(admit(reservation, [code.candidate]));
        const paidAt = Temporal.Now.instant();

        const first = await succeed(markPaid(reservation, attempt.id, paidAt));
        const again = await succeed(
          markPaid(reservation, attempt.id, paidAt.add({ minutes: 1 }))
        );

        expect(first.changed).toBe(true);
        expect(again.changed).toBe(false);
        expect(again.timestamp.toString()).toBe(first.timestamp.toString());
        expect(
          await claimState("discount_code_redemptions", attempt.id)
        ).toEqual(["redeemed"]);
      });

      test("refuses an unknown reservation, a failed attempt, and a reservation that left pending", async () => {
        const customer = newCustomer();
        const reservation = await heldReservation(customer);
        const failed = await succeed(admit(reservation));
        await expire(reservation, failed.id);

        expect(
          await lifecycle((repository) =>
            repository.markPaid({
              id: failed.id,
              workspaceReservationId: crypto.randomUUID() as never,
              paidAt: Temporal.Now.instant(),
            })
          )
        ).toMatchObject(stateError("markPaid"));
        expect(await markPaid(reservation, failed.id)).toMatchObject(
          stateError("markPaid")
        );

        const pending = await succeed(admit(reservation));
        await sql(
          "update workspace_reservations set payment_state = 'failed', failure_code = 'outcome_test' where id = $1",
          [reservation.id]
        );
        expect(await markPaid(reservation, pending.id)).toMatchObject(
          stateError("markPaid")
        );
        expect(
          await sql("select state from payment_attempts where id = $1", [
            pending.id,
          ])
        ).toEqual([{ state: "created" }]);
      });

      test("refuses to redeem a code or invitation claim that was released", async () => {
        const customer = newCustomer();
        const code = await createDiscountCode(customer);
        const codeReservation = await heldReservation(customer);
        const codeAttempt = await succeed(
          admit(codeReservation, [code.candidate])
        );
        await sql(
          "update discount_code_redemptions set state = 'released', released_at = now(), release_reason = 'outcome_test' where payment_attempt_id = $1",
          [codeAttempt.id]
        );
        expect(await markPaid(codeReservation, codeAttempt.id)).toMatchObject(
          claimError("claim_conflict", "redeem")
        );

        const invited = newCustomer();
        const referral = await createReferral(invited);
        const referralReservation = await heldReservation(invited);
        const referralAttempt = await succeed(
          admit(referralReservation, [referral.invitation()])
        );
        await sql(
          "update referral_invitation_claims set state = 'released', released_at = now(), release_reason = 'outcome_test' where payment_attempt_id = $1",
          [referralAttempt.id]
        );
        expect(
          await markPaid(referralReservation, referralAttempt.id)
        ).toMatchObject(claimError("claim_conflict", "redeem"));
      });

      test("redeems a checkout invitation once, then repeats unchanged", async () => {
        const invited = newCustomer();
        const referral = await createReferral(invited);
        const reservation = await heldReservation(invited);
        const attempt = await succeed(
          admit(reservation, [referral.invitation()])
        );

        await succeed(markPaid(reservation, attempt.id));
        const again = await succeed(markPaid(reservation, attempt.id));

        expect(again.changed).toBe(false);
        expect(
          await claimState("referral_invitation_claims", attempt.id)
        ).toEqual(["redeemed"]);
        expect(
          await sql(
            "select referrer_dotypos_customer_id from referral_attributions where invited_dotypos_customer_id = $1",
            [invited]
          )
        ).toEqual([{ referrer_dotypos_customer_id: referral.referrer }]);
      });

      test("an older claim pays on its accepted attribution and fails once that attribution is gone", async () => {
        const invited = newCustomer();
        const referral = await createReferral(invited);
        await Effect.runPromise(
          testDatabase.db.insert(referralAttributions).values({
            invitedDotyposCustomerId: invited,
            referrerDotyposCustomerId: referral.referrer,
            promotionCodeId: promotionCodeIdSchema.make(referral.promotionId),
          })
        );
        const asOlderClaim = (id: PaymentAttemptId) =>
          sql(
            "update referral_invitation_claims set referrer_dotypos_customer_id = null, promotion_code_id = null where payment_attempt_id = $1",
            [id]
          );
        const withAttribution = await heldReservation(invited);
        const kept = await succeed(
          admit(withAttribution, [referral.invitation()])
        );
        await asOlderClaim(kept.id);
        await succeed(markPaid(withAttribution, kept.id));
        expect(await claimState("referral_invitation_claims", kept.id)).toEqual(
          ["redeemed"]
        );

        const laterInvited = newCustomer();
        const laterReferral = await createReferral(laterInvited);
        await Effect.runPromise(
          testDatabase.db.insert(referralAttributions).values({
            invitedDotyposCustomerId: laterInvited,
            referrerDotyposCustomerId: laterReferral.referrer,
            promotionCodeId: promotionCodeIdSchema.make(
              laterReferral.promotionId
            ),
          })
        );
        const withoutAttribution = await heldReservation(laterInvited);
        const lost = await succeed(
          admit(withoutAttribution, [laterReferral.invitation()])
        );
        await asOlderClaim(lost.id);
        await sql(
          "delete from referral_attributions where invited_dotypos_customer_id = $1",
          [laterInvited]
        );
        expect(await markPaid(withoutAttribution, lost.id)).toMatchObject(
          claimError("claim_conflict", "redeem")
        );
        expect(await claimState("referral_invitation_claims", lost.id)).toEqual(
          ["reserved"]
        );
      });

      test("refuses an invitation once another booking of the invitee was paid", async () => {
        const invited = newCustomer();
        const referral = await createReferral(invited);
        const reservation = await heldReservation(invited);
        const attempt = await succeed(
          admit(reservation, [referral.invitation()])
        );
        await paidReservation(invited);

        expect(await markPaid(reservation, attempt.id)).toMatchObject(
          claimError("claim_conflict", "redeem")
        );
      });
    });

    describe("late recovery of released claims", () => {
      test("re-redeems a released code within its limits, and refuses an exhausted code", async () => {
        const customer = newCustomer();
        const kept = await createDiscountCode(customer, {
          maxUses: 5,
          maxUsesPerCustomer: 2,
        });
        const keptReservation = await heldReservation(customer);
        const keptAttempt = await succeed(
          admit(keptReservation, [kept.candidate])
        );
        await expire(keptReservation, keptAttempt.id);
        await succeed(recoverLatePayment(keptReservation, keptAttempt.id));
        expect(
          await claimState("discount_code_redemptions", keptAttempt.id)
        ).toEqual(["redeemed"]);

        for (const limits of [
          { maxUsesPerCustomer: 1 },
          { maxUses: 1 },
        ] as const) {
          const code = await createDiscountCode(customer, limits);
          const reservation = await heldReservation(customer);
          const attempt = await succeed(admit(reservation, [code.candidate]));
          await expire(reservation, attempt.id);
          const retry = await heldReservation(customer);
          await succeed(admit(retry, [code.candidate]));

          expect(
            await recoverLatePayment(reservation, attempt.id)
          ).toMatchObject(claimError("usage_limit_reached", "redeem"));
          expect(
            await claimState("discount_code_redemptions", attempt.id)
          ).toEqual(["released"]);
        }
      });

      test("re-redeems released voucher credit only while it lasts", async () => {
        const customer = newCustomer();
        const voucher = await createVoucher(customer, 10_000);
        const reservation = await heldReservation(customer);
        const attempt = await succeed(
          admit(reservation, [voucher.offer(10_000)])
        );
        await expire(reservation, attempt.id);
        await succeed(recoverLatePayment(reservation, attempt.id));
        expect(await claimState("voucher_redemptions", attempt.id)).toEqual([
          "redeemed",
        ]);

        const spent = await createVoucher(customer, 10_000);
        const spentReservation = await heldReservation(customer);
        const spentAttempt = await succeed(
          admit(spentReservation, [spent.offer(10_000)])
        );
        await expire(spentReservation, spentAttempt.id);
        await succeed(
          admit(await heldReservation(customer), [spent.offer(10_000)])
        );
        expect(
          await recoverLatePayment(spentReservation, spentAttempt.id)
        ).toMatchObject(claimError("claim_conflict", "redeem"));
      });

      test("refuses a released invitation another paid booking consumed", async () => {
        const invited = newCustomer();
        const referral = await createReferral(invited);
        const reservation = await heldReservation(invited);
        const attempt = await succeed(
          admit(reservation, [referral.invitation()])
        );
        await expire(reservation, attempt.id);
        await paidReservation(invited);

        expect(await recoverLatePayment(reservation, attempt.id)).toMatchObject(
          { _tag: "Failure", failure: { _tag: "DiscountClaimError" } }
        );
        expect(
          await claimState("referral_invitation_claims", attempt.id)
        ).toEqual(["released"]);
      });
    });
  }
);
