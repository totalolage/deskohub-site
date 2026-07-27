import { and, count, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import {
  discountCodeCustomers,
  discountCodeRedemptions,
  discountCodes,
  discountProductTargets,
  discounts,
} from "@/db/schema";
import type { DatabaseClient } from "@/db/database-client";
import type { WorkspaceProductIdentity } from "@/features/checkout/product-identity";
import type {
  CanonicalDiscountCode,
  DiscountCodeId,
  StoredDiscountId,
} from "@/features/discounts/persistence-contracts";
import { type WorkspaceE2EError, workspaceE2EError } from "../errors";
import { log } from "../runtime";
import {
  runDatabaseOperation,
  runRetrySafeDatabaseOperation,
} from "./database-operation";
import { E2EDatabase } from "./database.service";

export const E2E_CALENDAR_SALE_DISCOUNT_ID =
  "454784dd-380b-43a1-bae7-cc070bf1aec2" as StoredDiscountId;

export const discountCodeFixtures = {
  partial: {
    code: "E2E_PARTIAL" as CanonicalDiscountCode,
    id: "6bb95a13-3801-4ba5-947e-c24cd3a416a2" as DiscountCodeId,
  },
  inactive: {
    code: "E2E_INACTIVE" as CanonicalDiscountCode,
    id: "2f7e1000-732a-4ab7-9513-a3aaef764aae" as DiscountCodeId,
  },
  notStarted: {
    code: "E2E_NOT_STARTED" as CanonicalDiscountCode,
    id: "6288a6cd-bc01-46d4-a87a-067b01e64226" as DiscountCodeId,
  },
  expired: {
    code: "E2E_EXPIRED" as CanonicalDiscountCode,
    id: "e33f90e0-311d-445f-b73b-29725e7f00ab" as DiscountCodeId,
  },
  customerIneligible: {
    code: "E2E_NOT_YOURS" as CanonicalDiscountCode,
    id: "f80104f4-0db4-4c83-a1a5-e42976e041bd" as DiscountCodeId,
  },
  productIneligible: {
    code: "E2E_WRONG_PRODUCT" as CanonicalDiscountCode,
    id: "f8774fff-009a-474c-a338-3b52c612a16c" as DiscountCodeId,
  },
  expiresBeforePayment: {
    code: "E2E_EXPIRES_BEFORE_PAY" as CanonicalDiscountCode,
    id: "2169ca5a-b422-46b2-a58d-8881e15db3ef" as DiscountCodeId,
  },
  zeroTotal: {
    code: "E2E_ZERO_TOTAL" as CanonicalDiscountCode,
    id: "019c91de-61d7-7ccb-adb8-f4de2a5a32b8" as DiscountCodeId,
  },
  capacityOne: {
    code: "E2E_CAPACITY_ONE" as CanonicalDiscountCode,
    id: "307e7850-c893-46e2-ad8e-bf5f67a21e42" as DiscountCodeId,
  },
  onePerCustomer: {
    code: "E2E_ONE_PER_CUSTOMER" as CanonicalDiscountCode,
    id: "2b89472c-a804-461a-b07d-a2a69e2cc7ec" as DiscountCodeId,
  },
} as const;

const partialCodeDiscountId =
  "816a6ec2-514e-45d2-afdd-5c04f13f9a84" as StoredDiscountId;
const plusOnlyCodeDiscountId =
  "521293fa-37da-4067-b1bb-7b400112df34" as StoredDiscountId;
const zeroTotalDiscountId =
  "019c91dd-c560-7e55-b9d8-c95065efd51d" as StoredDiscountId;

const definitions: readonly DiscountDefinitionFixture[] = [
  {
    basisPoints: 2000,
    id: E2E_CALENDAR_SALE_DISCOUNT_ID,
    labels: {
      "cs-CZ": "E2E kalendářová sleva",
      "en-US": "E2E Calendar sale",
    },
    products: [
      { kind: "cowork", tier: "plus" },
      { kind: "cowork", tier: "profi" },
      { kind: "meeting-room", durationMinutes: 60 },
    ],
  },
  {
    basisPoints: 1000,
    id: partialCodeDiscountId,
    labels: {
      "cs-CZ": "E2E promo kód",
      "en-US": "E2E promo code",
    },
    products: [
      { kind: "cowork", tier: "basic" },
      { kind: "cowork", tier: "plus" },
    ],
  },
  {
    basisPoints: 1000,
    id: plusOnlyCodeDiscountId,
    labels: {
      "cs-CZ": "E2E promo kód pro Plus",
      "en-US": "E2E Plus-only promo code",
    },
    products: [{ kind: "cowork", tier: "plus" }],
  },
  {
    basisPoints: 10_000,
    id: zeroTotalDiscountId,
    labels: {
      "cs-CZ": "E2E sleva 100 %",
      "en-US": "E2E 100% discount",
    },
    products: [{ kind: "cowork", tier: "basic" }],
  },
];

export const seedDiscountE2EFixtures: Effect.Effect<
  void,
  WorkspaceE2EError,
  E2EDatabase
> =
  Effect.gen(function* () {
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
                definition.products.map((productIdentity) => ({
                  discountId: definition.id,
                  productIdentity,
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
                  discountCodeFixtures.capacityOne.id as DiscountCodeId
                ),
                inArray(discountCodeRedemptions.state, [
                  "reserved",
                  "redeemed",
                ])
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
              allowedCustomerIds: ["workspace-e2e-other-customer"],
              discountId: partialCodeDiscountId,
              enabled: true,
            },
            {
              ...discountCodeFixtures.productIneligible,
              discountId: plusOnlyCodeDiscountId,
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
            },
          ];

          for (const code of codeFixtures) {
            yield* seedDiscountCode(tx, code);
          }
        })
      )
    );

    log("Discount E2E fixtures seeded");
  });

export const expireDiscountCodeForE2E = (
  codeId: string
): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const { db } = yield* E2EDatabase;
    const rows = yield* runRetrySafeDatabaseOperation(
      "expire E2E discount code",
      db
        .update(discountCodes)
        .set({
          updatedAt: Temporal.Now.instant(),
          validUntil: Temporal.Instant.from("2000-01-01T00:00:00Z"),
        })
        .where(eq(discountCodes.id, codeId as DiscountCodeId))
        .returning({ id: discountCodes.id })
    );

    if (rows.length !== 1 || rows[0]?.id !== codeId) {
      return yield* workspaceE2EError(
        "E2E discount code fixture could not be expired",
        {
          operation: "expire E2E discount code",
        }
      );
    }
  });

export const setE2ECalendarSaleProfiEligibility = (
  eligible: boolean
): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const { db } = yield* E2EDatabase;
    const product = {
      kind: "cowork",
      tier: "profi",
    } satisfies WorkspaceProductIdentity;

    yield* runRetrySafeDatabaseOperation(
      eligible
        ? "restore E2E Calendar sale Profi eligibility"
        : "remove E2E Calendar sale Profi eligibility",
      eligible
        ? db
            .insert(discountProductTargets)
            .values({
              discountId: E2E_CALENDAR_SALE_DISCOUNT_ID,
              productIdentity: product,
            })
            .onConflictDoNothing()
        : db.delete(discountProductTargets).where(
            and(
              eq(
                discountProductTargets.discountId,
                E2E_CALENDAR_SALE_DISCOUNT_ID
              ),
              eq(discountProductTargets.productIdentity, product)
            )
          )
    );
  });

interface DiscountDefinitionFixture {
  readonly basisPoints: number;
  readonly id: StoredDiscountId;
  readonly labels: Readonly<Record<"cs-CZ" | "en-US", string>>;
  readonly products: readonly WorkspaceProductIdentity[];
}

interface DiscountCodeFixture {
  readonly allowedCustomerIds?: readonly string[];
  readonly code: CanonicalDiscountCode;
  readonly discountId: StoredDiscountId;
  readonly enabled: boolean;
  readonly id: DiscountCodeId;
  readonly maxUses?: number;
  readonly validFrom?: Temporal.Instant;
  readonly validUntil?: Temporal.Instant;
}

type TransactionClient = Parameters<
  Parameters<DatabaseClient["transaction"]>[0]
>[0];

const seedDiscountCode = (
  tx: TransactionClient,
  fixture: DiscountCodeFixture
) =>
  Effect.gen(function* () {
    yield* tx
      .insert(discountCodes)
      .values({
        code: fixture.code,
        discountId: fixture.discountId,
        enabled: fixture.enabled,
        id: fixture.id,
        maxUses: fixture.maxUses ?? null,
        validFrom: fixture.validFrom ?? null,
        validUntil: fixture.validUntil ?? null,
      })
      .onConflictDoUpdate({
        target: discountCodes.code,
        set: {
          discountId: fixture.discountId,
          enabled: fixture.enabled,
          maxUses: fixture.maxUses ?? null,
          updatedAt: Temporal.Now.instant(),
          validFrom: fixture.validFrom ?? null,
          validUntil: fixture.validUntil ?? null,
        },
      });
    yield* tx
      .delete(discountCodeCustomers)
      .where(eq(discountCodeCustomers.codeId, fixture.id));
    const allowedCustomerIds = fixture.allowedCustomerIds ?? [];
    if (allowedCustomerIds.length > 0) {
      yield* tx
        .insert(discountCodeCustomers)
        .values(
          allowedCustomerIds.map((dotyposCustomerId) => ({
            codeId: fixture.id,
            dotyposCustomerId,
          }))
        )
        .onConflictDoNothing();
    }
  });
