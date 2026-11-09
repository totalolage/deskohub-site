import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import {
  type DotyposCustomerId,
  DotyposCustomerIdSchema,
} from "@deskohub/dotypos";
import { NexiOrderIdSchema } from "@deskohub/nexi";
import { Effect, Option } from "effect";
import {
  type DiscountCodeClaimState,
  discountApplications,
  discountCodeRedemptions,
  discountCodes,
  discounts,
  paymentAttempts,
  promotionCodeCustomers,
  promotionCodes,
  voucherRedemptions,
  vouchers,
} from "@/db/schema";
import {
  type PaymentAttemptId,
  paymentAttemptIdSchema,
} from "@/features/checkout/checkout-identifiers";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { discountIdSchema } from "./contracts";
import {
  canonicalPromotionCodeSchema,
  type DiscountCodeId,
  discountCodeIdSchema,
  type PromotionCodeId,
  promotionCodeIdSchema,
  type StoredDiscountId,
  storedDiscountIdSchema,
  type VoucherId,
  voucherIdSchema,
} from "./persistence-contracts";
import { PromotionCodeRepository } from "./promotion-code.repository";

const testDatabase = await connectWorkspacePostgresTestDatabase();

describe.skipIf(!testDatabase)(
  "PromotionCodeRepository on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const promotionCodeIds: PromotionCodeId[] = [];
    const discountIds: StoredDiscountId[] = [];
    const paymentAttemptIds: PaymentAttemptId[] = [];

    afterAll(async () => {
      await testDatabase.pool.query(
        "delete from discount_code_redemptions where payment_attempt_id = any($1)",
        [paymentAttemptIds]
      );
      await testDatabase.pool.query(
        "delete from voucher_redemptions where payment_attempt_id = any($1)",
        [paymentAttemptIds]
      );
      await testDatabase.pool.query(
        "delete from discount_applications where payment_attempt_id = any($1)",
        [paymentAttemptIds]
      );
      await testDatabase.pool.query(
        "delete from workspace_reservations where id in (select workspace_reservation_id from payment_attempts where id = any($1))",
        [paymentAttemptIds]
      );
      await testDatabase.pool.query(
        "delete from promotion_codes where id = any($1)",
        [promotionCodeIds]
      );
      await testDatabase.pool.query(
        "delete from discounts where id = any($1)",
        [discountIds]
      );
    });

    const run = <A, E>(
      operation: (
        repository: typeof PromotionCodeRepository.Service
      ) => Effect.Effect<A, E>
    ) =>
      Effect.runPromise(
        Effect.gen(function* () {
          return yield* operation(yield* PromotionCodeRepository);
        }).pipe(
          Effect.provide(PromotionCodeRepository.Default),
          Effect.provide(testDatabase.layer)
        )
      );

    const makeCustomerId = () =>
      DotyposCustomerIdSchema.make(`promotion-customer-${crypto.randomUUID()}`);

    /** Inserts the shared promotion registry row with its customer audience. */
    const insertPromotionCode = async (input: {
      readonly kind: "discount" | "voucher" | "referral";
      readonly audience: readonly DotyposCustomerId[];
    }) => {
      const id = crypto.randomUUID();
      const promotionCodeId = promotionCodeIdSchema.make(id);
      const code = canonicalPromotionCodeSchema.make(
        `PG-${id.replaceAll("-", "").toUpperCase()}`
      );
      promotionCodeIds.push(promotionCodeId);
      await Effect.runPromise(
        testDatabase.db.insert(promotionCodes).values({
          id: promotionCodeId,
          kind: input.kind,
          code,
          enabled: true,
        })
      );
      if (input.audience.length > 0) {
        await Effect.runPromise(
          testDatabase.db.insert(promotionCodeCustomers).values(
            input.audience.map((dotyposCustomerId) => ({
              promotionCodeId,
              dotyposCustomerId,
            }))
          )
        );
      }
      return { id, promotionCodeId, code };
    };

    /** Inserts a synthetic ordinary discount code with its shared promotion. */
    const insertDiscountCode = async (
      input: { readonly audience?: readonly DotyposCustomerId[] } = {}
    ) => {
      const discountId = storedDiscountIdSchema.make(crypto.randomUUID());
      discountIds.push(discountId);
      await Effect.runPromise(
        testDatabase.db.insert(discounts).values({
          id: discountId,
          labels: { "cs-CZ": "Testovací kód", "en-US": "Test code" },
          percentageBasisPoints: 1000,
        })
      );
      const promotion = await insertPromotionCode({
        kind: "discount",
        audience: input.audience ?? [],
      });
      const codeId = discountCodeIdSchema.make(promotion.id);
      await Effect.runPromise(
        testDatabase.db.insert(discountCodes).values({
          id: codeId,
          code: promotion.code,
          enabled: true,
          promotionCodeId: promotion.promotionCodeId,
          discountId,
        })
      );
      return { promotionCodeId: promotion.promotionCodeId, codeId };
    };

    /** Inserts a synthetic promotional-credit voucher with its shared promotion. */
    const insertVoucher = async () => {
      const promotion = await insertPromotionCode({
        kind: "voucher",
        audience: [],
      });
      const voucherId = voucherIdSchema.make(promotion.id);
      await Effect.runPromise(
        testDatabase.db.insert(vouchers).values({
          id: voucherId,
          promotionCodeId: promotion.promotionCodeId,
          issuedAmountValue: 100_000,
          issuedAmountExponent: 2,
          issuedAmountCurrency: "CZK",
        })
      );
      return { promotionCodeId: promotion.promotionCodeId, voucherId };
    };

    /**
     * Inserts a synthetic checkout and its immutable discount application, the
     * evidence every code or voucher claim references.
     */
    const insertDiscountApplication = async (input: {
      readonly dotyposCustomerId: DotyposCustomerId;
      readonly appliedAmountValue: number;
    }) => {
      const id = crypto.randomUUID();
      const paymentAttemptId = paymentAttemptIdSchema.make(
        `promotion-attempt-${id}`
      );
      paymentAttemptIds.push(paymentAttemptId);
      const { id: workspaceReservationId } = await Effect.runPromise(
        workspaceFixtures(testDatabase.db).reservation({
          stage: { reservation: "draft", payment: "pending" },
          customer: input.dotyposCustomerId,
        })
      );
      await Effect.runPromise(
        testDatabase.db.insert(paymentAttempts).values({
          id: paymentAttemptId,
          workspaceReservationId,
          provider: "nexi",
          providerOrderId: NexiOrderIdSchema.make(`order-${id}`),
          state: "pending",
          amountValue: 50_000 - input.appliedAmountValue,
          amountExponent: 2,
          currency: "CZK",
        })
      );
      const [application] = await Effect.runPromise(
        testDatabase.db
          .insert(discountApplications)
          .values({
            paymentAttemptId,
            workspaceReservationId,
            sequence: 0,
            publicDiscountId: discountIdSchema.make(`promotion-discount-${id}`),
            label: "Test code",
            adjustment: { kind: "percentage", basisPoints: 1000 },
            productIdentity: { kind: "cowork" },
            subtotalBeforeValue: 50_000,
            subtotalBeforeExponent: 2,
            subtotalBeforeCurrency: "CZK",
            appliedAmountValue: input.appliedAmountValue,
            appliedAmountExponent: 2,
            appliedAmountCurrency: "CZK",
            subtotalAfterValue: 50_000 - input.appliedAmountValue,
            subtotalAfterExponent: 2,
            subtotalAfterCurrency: "CZK",
            provenance: { source: "promotion-code" },
          })
          .returning({ id: discountApplications.id })
      );
      if (!application) throw new Error("Discount application was not stored.");
      return { applicationId: application.id, paymentAttemptId };
    };

    /** Lifecycle columns that the claim-state check constraint requires. */
    const claimLifecycle = (state: DiscountCodeClaimState) => {
      const now = Temporal.Now.instant();
      return {
        state,
        reservationExpiresAt: now.add({ hours: 1 }),
        ...(state === "redeemed" && { redeemedAt: now }),
        ...(state === "released" && {
          releasedAt: now,
          releaseReason: "payment_expired",
        }),
      };
    };

    const claimDiscountCode = async (input: {
      readonly codeId: DiscountCodeId;
      readonly dotyposCustomerId: DotyposCustomerId;
      readonly state: DiscountCodeClaimState;
    }) => {
      const application = await insertDiscountApplication({
        dotyposCustomerId: input.dotyposCustomerId,
        appliedAmountValue: 5000,
      });
      await Effect.runPromise(
        testDatabase.db.insert(discountCodeRedemptions).values({
          codeId: input.codeId,
          dotyposCustomerId: input.dotyposCustomerId,
          ...application,
          ...claimLifecycle(input.state),
        })
      );
    };

    const claimVoucher = async (input: {
      readonly voucherId: VoucherId;
      readonly dotyposCustomerId: DotyposCustomerId;
      readonly state: DiscountCodeClaimState;
      readonly appliedAmountValue: number;
    }) => {
      const application = await insertDiscountApplication(input);
      await Effect.runPromise(
        testDatabase.db.insert(voucherRedemptions).values({
          voucherId: input.voucherId,
          dotyposCustomerId: input.dotyposCustomerId,
          ...application,
          ...claimLifecycle(input.state),
        })
      );
    };

    test("finds no ordinary promotion for a referral code, exactly as for an unknown code", async () => {
      // While the referral program is withheld, a referral code reaches the
      // ordinary code path, which must reject it as an unknown code.
      const referral = await insertPromotionCode({
        kind: "referral",
        audience: [],
      });
      const unknown = canonicalPromotionCodeSchema.make(
        `PG-${crypto.randomUUID().replaceAll("-", "").toUpperCase()}`
      );

      expect(
        await run((repository) =>
          repository.findByCode({ code: referral.code })
        )
      ).toEqual(Option.none());
      expect(
        await run((repository) => repository.findByCode({ code: unknown }))
      ).toEqual(Option.none());
    });

    test("reports an empty shared audience as unrestricted", async () => {
      const customerId = makeCustomerId();
      const code = await insertDiscountCode();
      const voucher = await insertVoucher();
      await insertDiscountCode({ audience: [customerId] });

      const codeAvailability = await run((repository) =>
        repository.loadDiscountCodeAvailability({
          ...code,
          dotyposCustomerId: customerId,
        })
      );
      const voucherAvailability = await run((repository) =>
        repository.loadVoucherAvailability({
          ...voucher,
          dotyposCustomerId: customerId,
        })
      );

      expect(codeAvailability).toMatchObject({
        allowlistSize: 0,
        customerAllowed: false,
      });
      expect(voucherAvailability).toMatchObject({
        allowlistSize: 0,
        customerAllowed: false,
      });
    });

    test("admits only Dotypos customers listed in this promotion's audience", async () => {
      const listedCustomerId = makeCustomerId();
      const otherListedCustomerId = makeCustomerId();
      const unlistedCustomerId = makeCustomerId();
      const code = await insertDiscountCode({
        audience: [listedCustomerId, otherListedCustomerId],
      });
      await insertDiscountCode({ audience: [unlistedCustomerId] });

      const loadFor = (dotyposCustomerId: DotyposCustomerId) =>
        run((repository) =>
          repository.loadDiscountCodeAvailability({
            ...code,
            dotyposCustomerId,
          })
        );

      expect(await loadFor(listedCustomerId)).toMatchObject({
        allowlistSize: 2,
        customerAllowed: true,
      });
      expect(await loadFor(unlistedCustomerId)).toMatchObject({
        allowlistSize: 2,
        customerAllowed: false,
      });
    });

    test("counts only reserved and redeemed ordinary code claims", async () => {
      const customerId = makeCustomerId();
      const otherCustomerId = makeCustomerId();
      const code = await insertDiscountCode();
      const otherCode = await insertDiscountCode();
      for (const state of ["reserved", "redeemed", "released"] as const) {
        await claimDiscountCode({
          codeId: code.codeId,
          dotyposCustomerId: customerId,
          state,
        });
      }
      for (const state of ["redeemed", "released"] as const) {
        await claimDiscountCode({
          codeId: code.codeId,
          dotyposCustomerId: otherCustomerId,
          state,
        });
      }
      await claimDiscountCode({
        codeId: otherCode.codeId,
        dotyposCustomerId: customerId,
        state: "reserved",
      });

      const availability = await run((repository) =>
        repository.loadDiscountCodeAvailability({
          ...code,
          dotyposCustomerId: customerId,
        })
      );
      const previewAvailability = await run((repository) =>
        repository.loadDiscountCodePreviewAvailability(code)
      );

      expect(availability).toEqual({
        allowlistSize: 0,
        customerAllowed: false,
        activeUseCount: 3,
        customerActiveUseCount: 2,
      });
      expect(previewAvailability).toEqual({ activeUseCount: 3 });
    });

    test("sums only reserved and redeemed voucher applications", async () => {
      const reservingCustomerId = makeCustomerId();
      const redeemedCustomerId = makeCustomerId();
      const voucher = await insertVoucher();
      const otherVoucher = await insertVoucher();
      await claimVoucher({
        voucherId: voucher.voucherId,
        dotyposCustomerId: reservingCustomerId,
        state: "reserved",
        appliedAmountValue: 1000,
      });
      await claimVoucher({
        voucherId: voucher.voucherId,
        dotyposCustomerId: redeemedCustomerId,
        state: "redeemed",
        appliedAmountValue: 2500,
      });
      await claimVoucher({
        voucherId: voucher.voucherId,
        dotyposCustomerId: redeemedCustomerId,
        state: "released",
        appliedAmountValue: 4000,
      });
      await claimVoucher({
        voucherId: otherVoucher.voucherId,
        dotyposCustomerId: redeemedCustomerId,
        state: "reserved",
        appliedAmountValue: 7000,
      });

      const loadFor = (dotyposCustomerId: DotyposCustomerId) =>
        run((repository) =>
          repository.loadVoucherAvailability({
            ...voucher,
            dotyposCustomerId,
          })
        );

      expect(await loadFor(reservingCustomerId)).toEqual({
        allowlistSize: 0,
        customerAllowed: false,
        customerHasReserved: true,
        usedValue: 3500,
      });
      expect(await loadFor(redeemedCustomerId)).toMatchObject({
        customerHasReserved: false,
        usedValue: 3500,
      });
    });
  }
);
