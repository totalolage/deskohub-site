import {
  type DotyposCustomerId,
  DotyposCustomerIdSchema,
} from "@deskohub/dotypos";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import { Effect } from "effect";
import { excludedColumn } from "@/db/excluded-column";
import {
  discountApplications,
  discountCodeRedemptions,
  discountCodes,
  discountProductTargets,
  discounts,
  promotionCodeCustomers,
  promotionCodes,
  voucherRedemptions,
  vouchers,
} from "@/db/schema";
import type {
  CanonicalPromotionCode,
  DiscountCodeId,
  StoredDiscountId,
  VoucherId,
} from "@/features/discounts/persistence-contracts";
import {
  canonicalPromotionCodeSchema,
  discountCodeIdSchema,
  promotionCodeIdSchema,
  storedDiscountIdSchema,
  voucherIdSchema,
} from "@/features/discounts/persistence-contracts";
import type { WorkspaceProductTarget } from "@/features/discounts/product-target";
import type { Money } from "@/shared/money/money";
import { type WorkspaceE2EError, workspaceE2EError } from "../errors";
import { log } from "../runtime";
import { E2EDatabase } from "./database.service";
import {
  runDatabaseOperation,
  runRetrySafeDatabaseOperation,
} from "./database-operation";

const E2E_CALENDAR_SALE_DISCOUNT_ID = storedDiscountIdSchema.make(
  "454784dd-380b-43a1-bae7-cc070bf1aec2"
);

export const discountCodeFixtures = {
  partial: {
    code: canonicalPromotionCodeSchema.make("E2E_PARTIAL"),
    id: discountCodeIdSchema.make("6bb95a13-3801-4ba5-947e-c24cd3a416a2"),
  },
  customerIneligible: {
    code: canonicalPromotionCodeSchema.make("E2E_NOT_YOURS"),
    id: discountCodeIdSchema.make("f80104f4-0db4-4c83-a1a5-e42976e041bd"),
  },
  expiresBeforePayment: {
    code: canonicalPromotionCodeSchema.make("E2E_EXPIRES_BEFORE_PAY"),
    id: discountCodeIdSchema.make("2169ca5a-b422-46b2-a58d-8881e15db3ef"),
  },
  zeroTotal: {
    code: canonicalPromotionCodeSchema.make("E2E_ZERO_TOTAL"),
    id: discountCodeIdSchema.make("019c91de-61d7-7ccb-adb8-f4de2a5a32b8"),
  },
  capacityOne: {
    code: canonicalPromotionCodeSchema.make("E2E_CAPACITY_ONE"),
    id: discountCodeIdSchema.make("307e7850-c893-46e2-ad8e-bf5f67a21e42"),
  },
  onePerCustomer: {
    code: canonicalPromotionCodeSchema.make("E2E_ONE_PER_CUSTOMER"),
    id: discountCodeIdSchema.make("2b89472c-a804-461a-b07d-a2a69e2cc7ec"),
  },
  voucherReuse: {
    code: canonicalPromotionCodeSchema.make("E2E_VOUCHER_REUSE"),
    // 2 × Open Space one-day after 20% Calendar sale (2 × 23_200).
    creditPerRun: { value: 46_400, exponent: 2, currency: "CZK" },
    id: voucherIdSchema.make("df62e84a-10be-49b4-ae62-6fa30765a6a9"),
  },
  voucherFull: {
    code: canonicalPromotionCodeSchema.make("E2E_VOUCHER_FULL"),
    creditPerRun: { value: 10_000, exponent: 2, currency: "CZK" },
    id: voucherIdSchema.make("7e171618-e39b-476f-a7c1-f753c664323f"),
  },
  accountReferralVoucher: {
    code: canonicalPromotionCodeSchema.make("E2E_REFERRAL_VOUCHER"),
    creditPerRun: { value: 10_000, exponent: 2, currency: "CZK" },
    id: voucherIdSchema.make("86f4bc91-6cb8-4815-9968-8edb38d1fce8"),
  },
} as const;

const partialCodeDiscountId = storedDiscountIdSchema.make(
  "816a6ec2-514e-45d2-afdd-5c04f13f9a84"
);
const zeroTotalDiscountId = storedDiscountIdSchema.make(
  "019c91dd-c560-7e55-b9d8-c95065efd51d"
);

const definitions: readonly DiscountDefinitionFixture[] = [
  {
    basisPoints: 2000,
    id: E2E_CALENDAR_SALE_DISCOUNT_ID,
    labels: {
      "cs-CZ": "E2E kalendářová sleva",
      "en-US": "E2E Calendar sale",
    },
    // Tier targets let calendar-sale-pricing-changes remove reserved-desk
    // eligibility without touching the open-space target other cases use.
    products: [
      { kind: "cowork", tier: "open-space" },
      { kind: "cowork", tier: "reserved-desk" },
      { kind: "meeting-room" },
    ],
  },
  {
    basisPoints: 1000,
    id: partialCodeDiscountId,
    labels: {
      "cs-CZ": "E2E promo kód",
      "en-US": "E2E promo code",
    },
    products: [{ kind: "cowork" }],
  },
  {
    basisPoints: 10_000,
    id: zeroTotalDiscountId,
    labels: {
      "cs-CZ": "E2E sleva 100 %",
      "en-US": "E2E 100% discount",
    },
    products: [{ kind: "cowork" }, { kind: "meeting-room" }],
  },
];

export const discountDefinitionFixtureIds = definitions.map(({ id }) => id);

const voucherFixtures: readonly VoucherFixture[] = [
  discountCodeFixtures.voucherReuse,
  discountCodeFixtures.voucherFull,
  discountCodeFixtures.accountReferralVoucher,
];

// One statement per table keeps the seed to a fixed number of round trips
// inside its transaction. Parents precede children so foreign keys and the
// promotion-code sync triggers, which read discount_codes, see their rows.
export const seedDiscountE2EFixtures: Effect.Effect<
  void,
  WorkspaceE2EError,
  E2EDatabase
> = Effect.gen(function* () {
  const { db } = yield* E2EDatabase;

  yield* runDatabaseOperation(
    "seed E2E discount fixtures",
    db.transaction(
      Effect.fn(function* (tx) {
        const updatedAt = Temporal.Now.instant();
        yield* tx
          .insert(discounts)
          .values(
            definitions.map((definition) => ({
              id: definition.id,
              labels: definition.labels,
              percentageBasisPoints: definition.basisPoints,
            }))
          )
          .onConflictDoUpdate({
            target: discounts.id,
            set: {
              fixedAmountCurrency: null,
              fixedAmountExponent: null,
              fixedAmountValue: null,
              labels: excludedColumn(discounts.labels),
              percentageBasisPoints: excludedColumn(
                discounts.percentageBasisPoints
              ),
              updatedAt,
            },
          });
        yield* tx.delete(discountProductTargets).where(
          inArray(
            discountProductTargets.discountId,
            definitions.map(({ id }) => id)
          )
        );
        yield* tx
          .insert(discountProductTargets)
          .values(
            definitions.flatMap((definition) =>
              definition.products.map((productTarget) => ({
                discountId: definition.id,
                productTarget,
              }))
            )
          )
          .onConflictDoNothing();

        // Earlier runs' active uses stay counted, so every run on a reused
        // preview database gets exactly one capacity use and one run's credit.
        const capacity = yield* tx
          .select({ activeUses: count() })
          .from(discountCodeRedemptions)
          .where(
            and(
              eq(
                discountCodeRedemptions.codeId,
                discountCodeFixtures.capacityOne.id
              ),
              inArray(discountCodeRedemptions.state, ["reserved", "redeemed"])
            )
          );
        const voucherUsage = yield* tx
          .select({
            usedValue: sql<number>`coalesce(sum(${discountApplications.appliedAmountValue}), 0)::integer`,
            voucherId: voucherRedemptions.voucherId,
          })
          .from(voucherRedemptions)
          .innerJoin(
            discountApplications,
            eq(discountApplications.id, voucherRedemptions.applicationId)
          )
          .where(
            and(
              inArray(
                voucherRedemptions.voucherId,
                voucherFixtures.map(({ id }) => id)
              ),
              inArray(voucherRedemptions.state, ["reserved", "redeemed"])
            )
          )
          .groupBy(voucherRedemptions.voucherId);
        const usedValueByVoucher = new Map(
          voucherUsage.map(({ usedValue, voucherId }) => [voucherId, usedValue])
        );
        const codeFixtures = makeDiscountCodeFixtures({
          capacityLimit: (capacity[0]?.activeUses ?? 0) + 1,
          now: Temporal.Now.instant().epochMilliseconds,
        });

        yield* tx
          .insert(promotionCodes)
          .values([
            ...codeFixtures.map((fixture) => ({
              code: fixture.code,
              enabled: fixture.enabled,
              id: promotionCodeIdSchema.make(fixture.id),
              kind: "discount" as const,
              validFrom: fixture.validFrom ?? null,
              validUntil: fixture.validUntil ?? null,
            })),
            ...voucherFixtures.map((fixture) => ({
              code: fixture.code,
              enabled: true,
              id: promotionCodeIdSchema.make(fixture.id),
              kind: "voucher" as const,
              validFrom: null,
              validUntil: null,
            })),
          ])
          .onConflictDoUpdate({
            target: promotionCodes.code,
            set: {
              enabled: excludedColumn(promotionCodes.enabled),
              kind: excludedColumn(promotionCodes.kind),
              updatedAt,
              validFrom: excludedColumn(promotionCodes.validFrom),
              validUntil: excludedColumn(promotionCodes.validUntil),
            },
          });
        yield* tx
          .insert(discountCodes)
          .values(
            codeFixtures.map((fixture) => ({
              code: fixture.code,
              discountId: fixture.discountId,
              enabled: fixture.enabled,
              id: fixture.id,
              maxUses: fixture.maxUses ?? null,
              maxUsesPerCustomer: fixture.maxUsesPerCustomer ?? null,
              promotionCodeId: promotionCodeIdSchema.make(fixture.id),
              validFrom: fixture.validFrom ?? null,
              validUntil: fixture.validUntil ?? null,
            }))
          )
          .onConflictDoUpdate({
            target: discountCodes.id,
            set: {
              code: excludedColumn(discountCodes.code),
              discountId: excludedColumn(discountCodes.discountId),
              enabled: excludedColumn(discountCodes.enabled),
              maxUses: excludedColumn(discountCodes.maxUses),
              maxUsesPerCustomer: excludedColumn(
                discountCodes.maxUsesPerCustomer
              ),
              promotionCodeId: excludedColumn(discountCodes.promotionCodeId),
              updatedAt,
              validFrom: excludedColumn(discountCodes.validFrom),
              validUntil: excludedColumn(discountCodes.validUntil),
            },
          });
        yield* tx.delete(promotionCodeCustomers).where(
          inArray(
            promotionCodeCustomers.promotionCodeId,
            [...codeFixtures, ...voucherFixtures].map(({ id }) =>
              promotionCodeIdSchema.make(id)
            )
          )
        );
        const allowedCustomers = codeFixtures.flatMap((fixture) =>
          (fixture.allowedCustomerIds ?? []).map((dotyposCustomerId) => ({
            dotyposCustomerId,
            promotionCodeId: promotionCodeIdSchema.make(fixture.id),
          }))
        );
        if (allowedCustomers.length > 0) {
          yield* tx
            .insert(promotionCodeCustomers)
            .values(allowedCustomers)
            .onConflictDoNothing();
        }
        yield* tx
          .insert(vouchers)
          .values(
            voucherFixtures.map((fixture) => ({
              id: fixture.id,
              issuedAmountCurrency: fixture.creditPerRun.currency,
              issuedAmountExponent: fixture.creditPerRun.exponent,
              issuedAmountValue:
                (usedValueByVoucher.get(fixture.id) ?? 0) +
                fixture.creditPerRun.value,
              promotionCodeId: promotionCodeIdSchema.make(fixture.id),
            }))
          )
          .onConflictDoUpdate({
            target: vouchers.id,
            set: {
              issuedAmountCurrency: excludedColumn(
                vouchers.issuedAmountCurrency
              ),
              issuedAmountExponent: excludedColumn(
                vouchers.issuedAmountExponent
              ),
              issuedAmountValue: excludedColumn(vouchers.issuedAmountValue),
              promotionCodeId: excludedColumn(vouchers.promotionCodeId),
              updatedAt,
            },
          });
      })
    )
  );

  log("Discount E2E fixtures seeded");
});

const makeDiscountCodeFixtures = ({
  capacityLimit,
  now,
}: {
  readonly capacityLimit: number;
  readonly now: number;
}): readonly DiscountCodeFixture[] => [
  {
    ...discountCodeFixtures.partial,
    discountId: partialCodeDiscountId,
    enabled: true,
  },
  {
    ...discountCodeFixtures.customerIneligible,
    allowedCustomerIds: [
      DotyposCustomerIdSchema.make("workspace-e2e-other-customer"),
    ],
    discountId: partialCodeDiscountId,
    enabled: true,
  },
  {
    ...discountCodeFixtures.expiresBeforePayment,
    discountId: partialCodeDiscountId,
    enabled: true,
    validUntil: Temporal.Instant.fromEpochMilliseconds(
      now + 24 * 60 * 60 * 1000
    ),
  },
  {
    ...discountCodeFixtures.zeroTotal,
    discountId: zeroTotalDiscountId,
    enabled: true,
  },
  {
    ...discountCodeFixtures.capacityOne,
    discountId: zeroTotalDiscountId,
    enabled: true,
    maxUses: capacityLimit,
  },
  {
    ...discountCodeFixtures.onePerCustomer,
    discountId: zeroTotalDiscountId,
    enabled: true,
    maxUsesPerCustomer: 1,
  },
];

export const expireDiscountCodeForE2E = (
  codeId: DiscountCodeId
): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const { db } = yield* E2EDatabase;
    const rows = yield* runRetrySafeDatabaseOperation(
      "expire E2E discount code",
      db
        .update(promotionCodes)
        .set({
          updatedAt: Temporal.Now.instant(),
          validUntil: Temporal.Instant.from("2000-01-01T00:00:00Z"),
        })
        .where(eq(promotionCodes.id, promotionCodeIdSchema.make(codeId)))
        .returning({ id: promotionCodes.id })
    );

    if (
      rows.length !== 1 ||
      rows[0]?.id !== promotionCodeIdSchema.make(codeId)
    ) {
      return yield* workspaceE2EError(
        "E2E discount code fixture could not be expired",
        {
          operation: "expire E2E discount code",
        }
      );
    }
  });

/**
 * Adds or removes only the reserved-desk target of the E2E Calendar sale. No
 * other case books reserved desk, so the open-space target stays put.
 */
export const setE2ECalendarSaleReservedDeskEligibility = (
  eligible: boolean
): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const { db } = yield* E2EDatabase;
    const product = {
      kind: "cowork",
      tier: "reserved-desk",
    } satisfies WorkspaceProductTarget;

    yield* runRetrySafeDatabaseOperation(
      eligible
        ? "restore E2E Calendar sale reserved-desk eligibility"
        : "remove E2E Calendar sale reserved-desk eligibility",
      eligible
        ? db
            .insert(discountProductTargets)
            .values({
              discountId: E2E_CALENDAR_SALE_DISCOUNT_ID,
              productTarget: product,
            })
            .onConflictDoNothing()
        : db
            .delete(discountProductTargets)
            .where(
              and(
                eq(
                  discountProductTargets.discountId,
                  E2E_CALENDAR_SALE_DISCOUNT_ID
                ),
                eq(discountProductTargets.productTarget, product)
              )
            )
    );
  });

interface DiscountDefinitionFixture {
  readonly basisPoints: number;
  readonly id: StoredDiscountId;
  readonly labels: Readonly<Record<"cs-CZ" | "en-US", string>>;
  readonly products: readonly WorkspaceProductTarget[];
}

interface DiscountCodeFixture {
  readonly allowedCustomerIds?: readonly DotyposCustomerId[];
  readonly code: CanonicalPromotionCode;
  readonly discountId: StoredDiscountId;
  readonly enabled: boolean;
  readonly id: DiscountCodeId;
  readonly maxUses?: number;
  readonly maxUsesPerCustomer?: number;
  readonly validFrom?: Temporal.Instant;
  readonly validUntil?: Temporal.Instant;
}

interface VoucherFixture {
  readonly code: CanonicalPromotionCode;
  readonly creditPerRun: Money;
  readonly id: VoucherId;
}
