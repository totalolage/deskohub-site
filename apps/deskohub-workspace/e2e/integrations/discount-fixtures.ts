import { Effect } from "effect";
import type { Pool } from "pg";
import type { WorkspaceProductIdentity } from "@/features/checkout/product-identity";
import type { DatasourceConfig } from "../config";
import { type WorkspaceE2EError, workspaceE2EError } from "../errors";
import { log } from "../runtime";
import { queryPostgres, withPostgresPool } from "./postgres";

export const E2E_CALENDAR_SALE_DISCOUNT_ID =
  "454784dd-380b-43a1-bae7-cc070bf1aec2";

export const discountCodeFixtures = {
  partial: {
    code: "E2E_PARTIAL",
    id: "6bb95a13-3801-4ba5-947e-c24cd3a416a2",
  },
  inactive: {
    code: "E2E_INACTIVE",
    id: "2f7e1000-732a-4ab7-9513-a3aaef764aae",
  },
  notStarted: {
    code: "E2E_NOT_STARTED",
    id: "6288a6cd-bc01-46d4-a87a-067b01e64226",
  },
  expired: {
    code: "E2E_EXPIRED",
    id: "e33f90e0-311d-445f-b73b-29725e7f00ab",
  },
  customerIneligible: {
    code: "E2E_NOT_YOURS",
    id: "f80104f4-0db4-4c83-a1a5-e42976e041bd",
  },
  productIneligible: {
    code: "E2E_WRONG_PRODUCT",
    id: "f8774fff-009a-474c-a338-3b52c612a16c",
  },
  expiresBeforePayment: {
    code: "E2E_EXPIRES_BEFORE_PAY",
    id: "2169ca5a-b422-46b2-a58d-8881e15db3ef",
  },
  zeroTotal: {
    code: "E2E_ZERO_TOTAL",
    id: "019c91de-61d7-7ccb-adb8-f4de2a5a32b8",
  },
  capacityOne: {
    code: "E2E_CAPACITY_ONE",
    id: "307e7850-c893-46e2-ad8e-bf5f67a21e42",
  },
  onePerCustomer: {
    code: "E2E_ONE_PER_CUSTOMER",
    id: "2b89472c-a804-461a-b07d-a2a69e2cc7ec",
  },
} as const;

const partialCodeDiscountId = "816a6ec2-514e-45d2-afdd-5c04f13f9a84";
const plusOnlyCodeDiscountId = "521293fa-37da-4067-b1bb-7b400112df34";
const zeroTotalDiscountId = "019c91dd-c560-7e55-b9d8-c95065efd51d";

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

export const seedDiscountE2EFixtures = (
  config: DatasourceConfig
): Effect.Effect<void, WorkspaceE2EError> =>
  withPostgresPool(config, (pool) =>
    Effect.gen(function* () {
      for (const definition of definitions) {
        yield* queryPostgres(
          pool,
          "seed E2E discount definition",
          `insert into discounts (
            id,
            labels,
            percentage_basis_points,
            created_at,
            updated_at
          ) values ($1, $2::jsonb, $3, now(), now())
          on conflict (id) do update
          set labels = excluded.labels,
            percentage_basis_points = excluded.percentage_basis_points,
            fixed_amount_value = null,
            fixed_amount_exponent = null,
            fixed_amount_currency = null,
            updated_at = now()`,
          [
            definition.id,
            JSON.stringify(definition.labels),
            definition.basisPoints,
          ]
        );
        yield* queryPostgres(
          pool,
          "replace E2E discount targets",
          "delete from discount_product_targets where discount_id = $1",
          [definition.id]
        );
        for (const product of definition.products) {
          yield* queryPostgres(
            pool,
            "seed E2E discount target",
            `insert into discount_product_targets (
              discount_id,
              product_identity
            ) values ($1, $2::jsonb)
            on conflict do nothing`,
            [definition.id, JSON.stringify(product)]
          );
        }
      }

      const now = Date.now();
      const capacity = yield* queryPostgres<{ active_uses: number }>(
        pool,
        "read E2E capacity-code usage",
        `select count(*)::int as active_uses
        from discount_code_redemptions
        where code_id = $1
          and state in ('reserved', 'redeemed')`,
        [discountCodeFixtures.capacityOne.id]
      );
      const capacityLimit = (capacity.rows[0]?.active_uses ?? 0) + 1;
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
          validFrom: new Date(now + 24 * 60 * 60 * 1000),
        },
        {
          ...discountCodeFixtures.expired,
          discountId: partialCodeDiscountId,
          enabled: true,
          validUntil: new Date(now - 60 * 60 * 1000),
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
          validUntil: new Date(now + 24 * 60 * 60 * 1000),
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
        yield* seedDiscountCode(pool, code);
      }

      log("Discount E2E fixtures seeded");
    })
  );

export const expireDiscountCodeForE2E = (
  config: DatasourceConfig,
  codeId: string
): Effect.Effect<void, WorkspaceE2EError> =>
  withPostgresPool(config, (pool) =>
    queryPostgres(
      pool,
      "expire E2E discount code",
      `update discount_codes
      set valid_until = timestamp '2000-01-01 00:00:00+00',
        updated_at = now()
      where id = $1`,
      [codeId]
    ).pipe(
      Effect.filterOrFail(
        ({ rowCount }) => rowCount === 1,
        () =>
          workspaceE2EError("E2E discount code fixture could not be expired", {
            operation: "expire E2E discount code",
          })
      ),
      Effect.asVoid
    )
  );

export const setE2ECalendarSaleProfiEligibility = (
  config: DatasourceConfig,
  eligible: boolean
): Effect.Effect<void, WorkspaceE2EError> =>
  withPostgresPool(config, (pool) => {
    const products: readonly WorkspaceProductIdentity[] = [
      { kind: "cowork", tier: "plus" },
      ...(eligible ? [{ kind: "cowork", tier: "profi" } as const] : []),
    ];

    return queryPostgres(
      pool,
      eligible
        ? "restore E2E Calendar sale Profi eligibility"
        : "remove E2E Calendar sale Profi eligibility",
      `with removed as (
        delete from discount_product_targets
        where discount_id = $1
      )
      insert into discount_product_targets (
        discount_id,
        product_identity
      )
      select $1, target
      from jsonb_array_elements($2::jsonb) as targets(target)`,
      [E2E_CALENDAR_SALE_DISCOUNT_ID, JSON.stringify(products)]
    ).pipe(Effect.asVoid);
  });

interface DiscountDefinitionFixture {
  readonly basisPoints: number;
  readonly id: string;
  readonly labels: Readonly<Record<"cs-CZ" | "en-US", string>>;
  readonly products: readonly WorkspaceProductIdentity[];
}

interface DiscountCodeFixture {
  readonly allowedCustomerIds?: readonly string[];
  readonly code: string;
  readonly discountId: string;
  readonly enabled: boolean;
  readonly id: string;
  readonly maxUses?: number;
  readonly validFrom?: Date;
  readonly validUntil?: Date;
}

const seedDiscountCode = (pool: Pool, fixture: DiscountCodeFixture) =>
  Effect.gen(function* () {
    yield* queryPostgres(
      pool,
      "seed E2E discount code",
      `insert into discount_codes (
        id,
        discount_id,
        code,
        enabled,
        valid_from,
        valid_until,
        max_uses,
        created_at,
        updated_at
      ) values ($1, $2, $3, $4, $5, $6, $7, now(), now())
      on conflict (code) do update
      set discount_id = excluded.discount_id,
        enabled = excluded.enabled,
        valid_from = excluded.valid_from,
        valid_until = excluded.valid_until,
        max_uses = excluded.max_uses,
        updated_at = now()`,
      [
        fixture.id,
        fixture.discountId,
        fixture.code,
        fixture.enabled,
        fixture.validFrom ?? null,
        fixture.validUntil ?? null,
        fixture.maxUses ?? null,
      ]
    );
    yield* queryPostgres(
      pool,
      "replace E2E discount code allowlist",
      "delete from discount_code_customers where code_id = $1",
      [fixture.id]
    );
    for (const customerId of fixture.allowedCustomerIds ?? []) {
      yield* queryPostgres(
        pool,
        "seed E2E discount code customer",
        `insert into discount_code_customers (
          code_id,
          dotypos_customer_id
        ) values ($1, $2)
        on conflict do nothing`,
        [fixture.id, customerId]
      );
    }
  });
