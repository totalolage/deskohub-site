import {
  type DotyposCustomerId,
  DotyposCustomerIdSchema,
} from "@deskohub/dotypos";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import { Effect } from "effect";
import type { DatabaseClient } from "@/db/database-client";
import {
  discountApplications,
  discountCodeRedemptions,
  discountCodes,
  discountProductTargets,
  discounts,
  promotionCodeCustomers,
  promotionCodes,
  voucherRedemptionAppliedAmountValue,
  voucherRedemptions,
  vouchers,
} from "@/db/schema";
import type { WorkspaceMoney } from "@/features/checkout/workspace-money";
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
import { type WorkspaceE2EError, workspaceE2EError } from "../errors";
import { log } from "../runtime";
import { E2EDatabase } from "./database.service";
import {
  runDatabaseOperation,
  runRetrySafeDatabaseOperation,
} from "./database-operation";

export const E2E_CALENDAR_SALE_DISCOUNT_ID = storedDiscountIdSchema.make(
  "454784dd-380b-43a1-bae7-cc070bf1aec2"
);

export const discountCodeFixtures = {
  partial: {
    code: canonicalPromotionCodeSchema.make("E2E_PARTIAL"),
    id: discountCodeIdSchema.make("6bb95a13-3801-4ba5-947e-c24cd3a416a2"),
  },
  inactive: {
    code: canonicalPromotionCodeSchema.make("E2E_INACTIVE"),
    id: discountCodeIdSchema.make("2f7e1000-732a-4ab7-9513-a3aaef764aae"),
  },
  notStarted: {
    code: canonicalPromotionCodeSchema.make("E2E_NOT_STARTED"),
    id: discountCodeIdSchema.make("6288a6cd-bc01-46d4-a87a-067b01e64226"),
  },
  expired: {
    code: canonicalPromotionCodeSchema.make("E2E_EXPIRED"),
    id: discountCodeIdSchema.make("e33f90e0-311d-445f-b73b-29725e7f00ab"),
  },
  customerIneligible: {
    code: canonicalPromotionCodeSchema.make("E2E_NOT_YOURS"),
    id: discountCodeIdSchema.make("f80104f4-0db4-4c83-a1a5-e42976e041bd"),
  },
  productIneligible: {
    code: canonicalPromotionCodeSchema.make("E2E_WRONG_PRODUCT"),
    id: discountCodeIdSchema.make("f8774fff-009a-474c-a338-3b52c612a16c"),
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
    creditPerRun: { value: 56_000, exponent: 2, currency: "CZK" },
    id: voucherIdSchema.make("df62e84a-10be-49b4-ae62-6fa30765a6a9"),
  },
  voucherFull: {
    code: canonicalPromotionCodeSchema.make("E2E_VOUCHER_FULL"),
    creditPerRun: { value: 10_000, exponent: 2, currency: "CZK" },
    id: voucherIdSchema.make("7e171618-e39b-476f-a7c1-f753c664323f"),
  },
} as const;

const partialCodeDiscountId = storedDiscountIdSchema.make(
  "816a6ec2-514e-45d2-afdd-5c04f13f9a84"
);
const wrongProductCodeDiscountId = storedDiscountIdSchema.make(
  "521293fa-37da-4067-b1bb-7b400112df34"
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
    products: [{ kind: "cowork" }, { kind: "meeting-room" }],
  },
  {
    basisPoints: 1000,
    id: partialCodeDiscountId,
    labels: {
      "cs-CZ": "E2E promo kód",
      "en-US": "E2E promo code",
    },
    products: [{ kind: "cowork" }, { kind: "goods" }],
  },
  {
    basisPoints: 1000,
    id: wrongProductCodeDiscountId,
    labels: {
      "cs-CZ": "E2E promo kód pro jiný produkt",
      "en-US": "E2E wrong-product promo code",
    },
    products: [{ kind: "meeting-room" }],
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

export const seedDiscountE2EFixtures: Effect.Effect<
  void,
  WorkspaceE2EError,
  E2EDatabase
> = Effect.gen(function* () {
  const { db } = yield* E2EDatabase;

  yield* runDatabaseOperation(
    "seed E2E discount fixtures",
    db.transaction((tx) =>
      Effect.gen(function* () {
        for (const definition of definitions) {
          yield* tx
            .insert(discounts)
            .values({
              id: definition.id,
              labels: definition.labels,
              percentageBasisPoints: definition.basisPoints,
            })
            .onConflictDoUpdate({
              target: discounts.id,
              set: {
                fixedAmountCurrency: null,
                fixedAmountExponent: null,
                fixedAmountValue: null,
                labels: definition.labels,
                percentageBasisPoints: definition.basisPoints,
                updatedAt: Temporal.Now.instant(),
              },
            });
          yield* tx
            .delete(discountProductTargets)
            .where(eq(discountProductTargets.discountId, definition.id));
          yield* tx
            .insert(discountProductTargets)
            .values(
              definition.products.map((productTarget) => ({
                discountId: definition.id,
                productTarget,
              }))
            )
            .onConflictDoNothing();
        }

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
        const capacityLimit = (capacity[0]?.activeUses ?? 0) + 1;
        const now = Temporal.Now.instant().epochMilliseconds;
        const codeFixtures: readonly DiscountCodeFixture[] = [
          {
            ...discountCodeFixtures.partial,
            discountId: partialCodeDiscountId,
            enabled: true,
          },
          {
            ...discountCodeFixtures.inactive,
            discountId: partialCodeDiscountId,
            enabled: false,
          },
          {
            ...discountCodeFixtures.notStarted,
            discountId: partialCodeDiscountId,
            enabled: true,
            validFrom: Temporal.Instant.fromEpochMilliseconds(
              now + 24 * 60 * 60 * 1000
            ),
          },
          {
            ...discountCodeFixtures.expired,
            discountId: partialCodeDiscountId,
            enabled: true,
            validUntil: Temporal.Instant.fromEpochMilliseconds(
              now - 60 * 60 * 1000
            ),
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
            ...discountCodeFixtures.productIneligible,
            discountId: wrongProductCodeDiscountId,
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

        for (const code of codeFixtures) {
          yield* seedDiscountCode(tx, code);
        }
        for (const fixture of [
          discountCodeFixtures.voucherReuse,
          discountCodeFixtures.voucherFull,
        ]) {
          const [voucherUsage] = yield* tx
            .select({
              usedValue: sql<number>`coalesce(sum(${voucherRedemptionAppliedAmountValue}), 0)::integer`,
            })
            .from(voucherRedemptions)
            .leftJoin(
              discountApplications,
              eq(discountApplications.id, voucherRedemptions.applicationId)
            )
            .where(
              and(
                eq(voucherRedemptions.voucherId, fixture.id),
                inArray(voucherRedemptions.state, ["reserved", "redeemed"])
              )
            );
          yield* seedVoucherCode(
            tx,
            fixture,
            (voucherUsage?.usedValue ?? 0) + fixture.creditPerRun.value
          );
        }
      })
    )
  );

  log("Discount E2E fixtures seeded");
});
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

export const setE2ECalendarSaleCoworkEligibility = (
  eligible: boolean
): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const { db } = yield* E2EDatabase;
    const product = { kind: "cowork" } satisfies WorkspaceProductTarget;

    yield* runRetrySafeDatabaseOperation(
      eligible
        ? "restore E2E Calendar sale cowork eligibility"
        : "remove E2E Calendar sale cowork eligibility",
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
  readonly creditPerRun: WorkspaceMoney;
  readonly id: VoucherId;
}

type TransactionClient = Parameters<
  Parameters<DatabaseClient["transaction"]>[0]
>[0];

const seedDiscountCode = (
  tx: TransactionClient,
  fixture: DiscountCodeFixture
) =>
  Effect.gen(function* () {
    const promotionCodeId = promotionCodeIdSchema.make(fixture.id);
    yield* tx
      .insert(promotionCodes)
      .values({
        code: fixture.code,
        enabled: fixture.enabled,
        id: promotionCodeId,
        kind: "discount",
        validFrom: fixture.validFrom ?? null,
        validUntil: fixture.validUntil ?? null,
      })
      .onConflictDoUpdate({
        target: promotionCodes.code,
        set: {
          enabled: fixture.enabled,
          kind: "discount",
          updatedAt: Temporal.Now.instant(),
          validFrom: fixture.validFrom ?? null,
          validUntil: fixture.validUntil ?? null,
        },
      });
    yield* tx
      .insert(discountCodes)
      .values({
        code: fixture.code,
        discountId: fixture.discountId,
        enabled: fixture.enabled,
        id: fixture.id,
        maxUses: fixture.maxUses ?? null,
        maxUsesPerCustomer: fixture.maxUsesPerCustomer ?? null,
        promotionCodeId,
        validFrom: fixture.validFrom ?? null,
        validUntil: fixture.validUntil ?? null,
      })
      .onConflictDoUpdate({
        target: discountCodes.id,
        set: {
          code: fixture.code,
          discountId: fixture.discountId,
          enabled: fixture.enabled,
          maxUses: fixture.maxUses ?? null,
          maxUsesPerCustomer: fixture.maxUsesPerCustomer ?? null,
          promotionCodeId,
          updatedAt: Temporal.Now.instant(),
          validFrom: fixture.validFrom ?? null,
          validUntil: fixture.validUntil ?? null,
        },
      });
    yield* tx
      .delete(promotionCodeCustomers)
      .where(eq(promotionCodeCustomers.promotionCodeId, promotionCodeId));
    const allowedCustomerIds = fixture.allowedCustomerIds ?? [];
    if (allowedCustomerIds.length > 0) {
      yield* tx
        .insert(promotionCodeCustomers)
        .values(
          allowedCustomerIds.map((dotyposCustomerId) => ({
            promotionCodeId,
            dotyposCustomerId,
          }))
        )
        .onConflictDoNothing();
    }
  });

const seedVoucherCode = (
  tx: TransactionClient,
  fixture: VoucherFixture,
  issuedValue: number
) =>
  Effect.gen(function* () {
    const promotionCodeId = promotionCodeIdSchema.make(fixture.id);
    yield* tx
      .insert(promotionCodes)
      .values({
        code: fixture.code,
        enabled: true,
        id: promotionCodeId,
        kind: "voucher",
      })
      .onConflictDoUpdate({
        target: promotionCodes.code,
        set: {
          enabled: true,
          kind: "voucher",
          updatedAt: Temporal.Now.instant(),
          validFrom: null,
          validUntil: null,
        },
      });
    yield* tx
      .insert(vouchers)
      .values({
        id: fixture.id,
        issuedAmountCurrency: fixture.creditPerRun.currency,
        issuedAmountExponent: fixture.creditPerRun.exponent,
        issuedAmountValue: issuedValue,
        promotionCodeId,
      })
      .onConflictDoUpdate({
        target: vouchers.id,
        set: {
          issuedAmountCurrency: fixture.creditPerRun.currency,
          issuedAmountExponent: fixture.creditPerRun.exponent,
          issuedAmountValue: issuedValue,
          promotionCodeId,
          updatedAt: Temporal.Now.instant(),
        },
      });
    yield* tx
      .delete(promotionCodeCustomers)
      .where(eq(promotionCodeCustomers.promotionCodeId, promotionCodeId));
  });
