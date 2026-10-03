import { describe, expect, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { GoogleCalendarService } from "@deskohub/google-calendar";
import { Effect, Layer, Schema } from "effect";
import type { WorkspaceDatabaseClient } from "@/db/database.service";
import { WorkspaceDatabase } from "@/db/database.service";
import type {
  NewDiscountCode,
  NewPromotionCode,
  NewStoredDiscount,
  NewVoucher,
} from "@/db/schema";
import {
  discountCodes,
  type discounts,
  promotionCodes,
  type vouchers,
} from "@/db/schema";
import { CalendarResourceConfig } from "@/shared/backend/config/calendar-resource.config";
import {
  type DiscountCodeId,
  discountCodeIdSchema,
  type StoredDiscountId,
  storedDiscountIdSchema,
} from "../persistence-contracts";
import {
  type CreateManagedDiscountCodeAdminInput,
  createManagedDiscountCodeAdminInputSchema,
  type UpdateDiscountCodeAdminInput,
  updateDiscountCodeAdminInputSchema,
} from "./contracts";
import {
  type AdminDiscountCodeDetail,
  type DiscountAdminCodesPage,
  DiscountAdministration,
  type DiscountAdminVouchersPage,
  findDiscountAdminConflict,
  getAdminDiscountCodeUsage,
  voucherDenominationCanChange,
} from "./discount-administration.service";

type AnyEffect = Effect.Effect<unknown, unknown>;

type FakeSelectBuilder = {
  readonly from: () => FakeSelectBuilder;
  readonly where: () => FakeSelectBuilder;
  readonly limit: () => FakeSelectBuilder;
  readonly for: () => AnyEffect;
};

type FakeInsertBuilder = {
  readonly returning: () => AnyEffect;
  readonly onConflictDoNothing: () => AnyEffect;
};

type FakeUpdateBuilder = {
  readonly where: () => AnyEffect;
};

type FakeTable =
  | typeof discountCodes
  | typeof promotionCodes
  | typeof discounts
  | typeof vouchers;

type FakeTx = {
  readonly select: () => FakeSelectBuilder;
  readonly insert: (table: FakeTable) => {
    readonly values: (values: FakeMutationValues) => FakeInsertBuilder;
  };
  readonly update: (table: FakeTable) => {
    readonly set: (values: FakeMutationValues) => FakeUpdateBuilder;
  };
};

type FakeMutationValues =
  | Partial<NewDiscountCode>
  | Partial<NewPromotionCode>
  | Partial<NewStoredDiscount>
  | Partial<NewVoucher>;

type FakeQueryTable<Row> = {
  readonly findMany: () => Effect.Effect<readonly Row[], never>;
  readonly findFirst?: () => Effect.Effect<Row | undefined, never>;
};

type FakeDb = {
  readonly transaction: (body: (tx: FakeTx) => AnyEffect) => AnyEffect;
  readonly query: {
    readonly discountCodes?: FakeQueryTable<CodeQueryRow>;
    readonly discounts?: FakeQueryTable<never>;
    readonly vouchers?: FakeQueryTable<VoucherQueryRow>;
  };
};

const makeDiscountAdministration = (fakeDb: FakeDb) =>
  DiscountAdministration.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(WorkspaceDatabase, {
          // The test double implements the database operations exercised below.
          db: Object.assign(fakeDb) as WorkspaceDatabaseClient,
        }),
        Layer.succeed(GoogleCalendarService, {} as never),
        Layer.succeed(DotyposService, {} as never),
        Layer.succeed(CalendarResourceConfig, {
          salesCalendarId: "sales-calendar",
        } as never)
      )
    )
  );

type CodeQueryRow = {
  readonly id: DiscountCodeId;
  readonly discountId: StoredDiscountId;
  readonly maxUses: number | null;
  readonly maxUsesPerCustomer: number | null;
  readonly serviceDateFrom: string | null;
  readonly serviceDateUntil: string | null;
  readonly promotion: {
    readonly code: string;
    readonly enabled: boolean;
    readonly validFrom: Temporal.Instant | null;
    readonly validUntil: Temporal.Instant | null;
    readonly createdAt: Temporal.Instant;
    readonly updatedAt: Temporal.Instant;
    readonly customers: readonly { readonly dotyposCustomerId: string }[];
  };
  readonly redemptions: readonly {
    readonly state: "reserved" | "redeemed" | "released";
    readonly application: {
      readonly appliedAmountValue: number;
      readonly appliedAmountExponent: number;
      readonly appliedAmountCurrency: string;
    };
  }[];
  readonly discount: { readonly labels: { readonly "en-US": string } };
};

type VoucherQueryRow = {
  readonly id: string;
  readonly promotionCodeId: string;
  readonly issuedAmountValue: number;
  readonly issuedAmountExponent: number;
  readonly issuedAmountCurrency: string;
  readonly promotion: CodeQueryRow["promotion"];
  readonly redemptions: CodeQueryRow["redemptions"];
};

describe("discount administration read models", () => {
  test("counts reserved and redeemed claims against capacity but excludes releases", () => {
    expect(
      getAdminDiscountCodeUsage({
        maxUses: 5,
        states: ["reserved", "redeemed", "released", "released"],
      })
    ).toEqual({
      reservedUses: 1,
      redeemedUses: 1,
      releasedUses: 2,
      remainingUses: 3,
    });
  });

  test("keeps unlimited capacity and floors exhausted codes at zero", () => {
    expect(
      getAdminDiscountCodeUsage({
        maxUses: null,
        states: ["redeemed"],
      }).remainingUses
    ).toBeNull();
    expect(
      getAdminDiscountCodeUsage({
        maxUses: 1,
        states: ["reserved", "redeemed"],
      }).remainingUses
    ).toBe(0);
  });
});

describe("discount administration conflicts", () => {
  test("keeps voucher denomination immutable after released claim history", () => {
    expect(
      voucherDenominationCanChange({
        claimCount: 1,
        current: { exponent: 2, currency: "CZK" },
        updated: { exponent: 2, currency: "EUR" },
      })
    ).toBe(false);
    expect(
      voucherDenominationCanChange({
        claimCount: 0,
        current: { exponent: 2, currency: "CZK" },
        updated: { exponent: 2, currency: "EUR" },
      })
    ).toBe(true);
  });

  test("recognizes durable code and reference constraint failures", () => {
    expect(
      findDiscountAdminConflict({
        cause: {
          constraint: "promotion_codes_code_unique_idx",
        },
      })
    ).toMatchObject({
      _tag: "DiscountAdminConflictError",
      message: "A promotion code with this value already exists.",
    });
    expect(
      findDiscountAdminConflict({
        reason: {
          cause: {
            constraint: "discount_codes_discount_id_discounts_id_fk",
          },
        },
      })
    ).toMatchObject({
      _tag: "DiscountAdminConflictError",
      message:
        "This discount is still referenced by a discount code and cannot be deleted.",
    });
    expect(
      findDiscountAdminConflict({
        constraint: "discount_code_redemptions_code_id_discount_codes_id_fk",
      })
    ).toMatchObject({
      _tag: "DiscountAdminConflictError",
      message: "This discount code has claims and cannot be deleted.",
    });
    expect(
      findDiscountAdminConflict({
        constraint: "voucher_redemptions_voucher_id_vouchers_id_fkey",
      })
    ).toMatchObject({
      _tag: "DiscountAdminConflictError",
      message: "This voucher has claims and cannot be deleted.",
    });
    expect(findDiscountAdminConflict(new Error("database unavailable"))).toBe(
      undefined
    );
  });
});

const testDiscountId = Schema.decodeUnknownSync(storedDiscountIdSchema)(
  "019c91dd-c560-7e55-b9d8-c95065efd51d"
);
const testCodeId = Schema.decodeUnknownSync(discountCodeIdSchema)("code-1");
const testVoucherId = "voucher-1";

type ServiceDateWindow = {
  readonly serviceDateFrom: string | null;
  readonly serviceDateUntil: string | null;
};

const baseCodeConfiguration = {
  code: "SUMMER10",
  enabled: true,
  validFrom: null,
  validUntil: null,
  maxUses: 100,
};

const decodeCreateCode = Schema.decodeUnknownSync(
  createManagedDiscountCodeAdminInputSchema
);
const decodeUpdateCode = Schema.decodeUnknownSync(
  updateDiscountCodeAdminInputSchema
);

const makeCreateCodeInput = (window?: ServiceDateWindow) =>
  decodeCreateCode({
    code: { ...baseCodeConfiguration, ...(window ?? {}) },
    discount: { kind: "existing", discountId: testDiscountId },
  });

const makeUpdateCodeInput = (window?: ServiceDateWindow) =>
  decodeUpdateCode({
    id: testCodeId,
    discountId: testDiscountId,
    ...baseCodeConfiguration,
    ...(window ?? {}),
  });

const promotionRow = {
  code: "SUMMER10",
  enabled: true,
  validFrom: null,
  validUntil: null,
  createdAt: Temporal.Instant.from("2026-08-01T00:00:00Z"),
  updatedAt: Temporal.Instant.from("2026-08-01T00:00:00Z"),
  customers: [],
};

const makeCodeRow = (
  window: ServiceDateWindow = {
    serviceDateFrom: null,
    serviceDateUntil: null,
  }
): CodeQueryRow => ({
  id: testCodeId,
  discountId: testDiscountId,
  maxUses: 100,
  maxUsesPerCustomer: null,
  ...window,
  promotion: promotionRow,
  redemptions: [],
  discount: { labels: { "en-US": "Summer discount" } },
});

describe("discount administration service dates", () => {
  type AdminUnderTest = {
    readonly createCode: (
      input: CreateManagedDiscountCodeAdminInput
    ) => Promise<DiscountCodeId>;
    readonly updateCode: (input: UpdateDiscountCodeAdminInput) => Promise<void>;
    readonly loadCodesPage: () => Promise<DiscountAdminCodesPage>;
    readonly loadCodeDetail: (input: {
      readonly codeId: DiscountCodeId;
    }) => Promise<AdminDiscountCodeDetail>;
    readonly loadVouchersPage: () => Promise<DiscountAdminVouchersPage>;
  };

  const run = async (
    fakeDb: FakeDb,
    run_: (admin: AdminUnderTest) => Promise<void>
  ) => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const admin = yield* DiscountAdministration;
        const unwrap = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
          Effect.runPromise(effect);
        yield* Effect.promise(() =>
          run_({
            createCode: (input: CreateManagedDiscountCodeAdminInput) =>
              unwrap(admin.createCode(input)),
            updateCode: (input: UpdateDiscountCodeAdminInput) =>
              unwrap(admin.updateCode(input)),
            loadCodesPage: () => unwrap(admin.loadCodesPage()),
            loadCodeDetail: (input) => unwrap(admin.loadCodeDetail(input)),
            loadVouchersPage: () => unwrap(admin.loadVouchersPage()),
          })
        );
      }).pipe(Effect.provide(makeDiscountAdministration(fakeDb)))
    );
  };

  const makeCodeDb = () => {
    const insertedDiscountCodeValues: FakeMutationValues[] = [];
    const updatedDiscountCodeSets: FakeMutationValues[] = [];
    const tx: FakeTx = {
      select: () => {
        const builder: FakeSelectBuilder = {
          from: () => builder,
          where: () => builder,
          limit: () => builder,
          for: () =>
            Effect.succeed([{ id: "code-1", promotionCodeId: "promotion-1" }]),
        };
        return builder;
      },
      insert: (table: FakeTable) => ({
        values: (values) => {
          if (table === discountCodes) {
            insertedDiscountCodeValues.push(values);
          }
          return {
            returning: () =>
              Effect.succeed(
                table === promotionCodes
                  ? [{ id: "promotion-1" }]
                  : [{ id: "code-1" }]
              ),
            onConflictDoNothing: () => Effect.succeed(undefined),
          };
        },
      }),
      update: (table: FakeTable) => ({
        set: (values) => {
          if (table === discountCodes) {
            updatedDiscountCodeSets.push(values);
          }
          return { where: () => Effect.succeed(undefined) };
        },
      }),
    };
    const db: FakeDb = {
      transaction: (body) => body(tx),
      query: {
        discountCodes: {
          findMany: () => Effect.succeed([]),
        },
      },
    };
    return {
      db,
      insertedDiscountCodeValues,
      updatedDiscountCodeSets,
    };
  };

  test("persists an omitted pair as null and a paired window on create", async () => {
    const { db, insertedDiscountCodeValues } = makeCodeDb();
    await run(db, async (admin) => {
      await admin.createCode(makeCreateCodeInput());
      await admin.createCode(
        makeCreateCodeInput({
          serviceDateFrom: "2026-08-10",
          serviceDateUntil: "2026-08-12",
        })
      );
    });

    expect(insertedDiscountCodeValues).toHaveLength(2);
    expect(insertedDiscountCodeValues[0]).toMatchObject({
      serviceDateFrom: null,
      serviceDateUntil: null,
    });
    expect(insertedDiscountCodeValues[1]).toMatchObject({
      serviceDateFrom: "2026-08-10",
      serviceDateUntil: "2026-08-12",
    });
  });

  test("preserves the existing window when the pair is omitted and replaces or clears it when given", async () => {
    const { db, updatedDiscountCodeSets } = makeCodeDb();
    await run(db, async (admin) => {
      await admin.updateCode(makeUpdateCodeInput());
      await admin.updateCode(
        makeUpdateCodeInput({
          serviceDateFrom: "2026-09-01",
          serviceDateUntil: "2026-09-05",
        })
      );
      await admin.updateCode(
        makeUpdateCodeInput({
          serviceDateFrom: null,
          serviceDateUntil: null,
        })
      );
    });

    expect(updatedDiscountCodeSets).toHaveLength(3);
    expect("serviceDateFrom" in updatedDiscountCodeSets[0]).toBe(false);
    expect("serviceDateUntil" in updatedDiscountCodeSets[0]).toBe(false);
    expect(updatedDiscountCodeSets[1]).toMatchObject({
      serviceDateFrom: "2026-09-01",
      serviceDateUntil: "2026-09-05",
    });
    expect(updatedDiscountCodeSets[2]).toMatchObject({
      serviceDateFrom: null,
      serviceDateUntil: null,
    });
  });

  test("round-trips service dates through list and detail projections and legacy rows read as null", async () => {
    const boundedRow = makeCodeRow({
      serviceDateFrom: "2026-08-10",
      serviceDateUntil: "2026-08-12",
    });
    const legacyRow = makeCodeRow();
    const db: FakeDb = {
      transaction: () => Effect.succeed(undefined),
      query: {
        discountCodes: {
          findMany: () => Effect.succeed([boundedRow, legacyRow]),
          findFirst: () => Effect.succeed(boundedRow),
        },
        discounts: { findMany: () => Effect.succeed([]) },
      },
    };

    await run(db, async (admin) => {
      const codesPage = await admin.loadCodesPage();
      expect(codesPage.codes.map((code) => code.serviceDateFrom)).toEqual([
        "2026-08-10",
        null,
      ]);
      expect(codesPage.codes.map((code) => code.serviceDateUntil)).toEqual([
        "2026-08-12",
        null,
      ]);

      const detail = await admin.loadCodeDetail({ codeId: testCodeId });
      expect(detail.code).toMatchObject({
        serviceDateFrom: "2026-08-10",
        serviceDateUntil: "2026-08-12",
      });
    });
  });

  test("keeps vouchers free of service-date fields", async () => {
    const voucherRow: VoucherQueryRow = {
      id: testVoucherId,
      promotionCodeId: "promotion-1",
      issuedAmountValue: 10000,
      issuedAmountExponent: 2,
      issuedAmountCurrency: "CZK",
      promotion: promotionRow,
      redemptions: [],
    };
    const db: FakeDb = {
      transaction: () => Effect.succeed(undefined),
      query: {
        discountCodes: { findMany: () => Effect.succeed([]) },
        discounts: { findMany: () => Effect.succeed([]) },
        vouchers: { findMany: () => Effect.succeed([voucherRow]) },
      },
    };

    await run(db, async (admin) => {
      const page = await admin.loadVouchersPage();
      expect(page.vouchers).toHaveLength(1);
      expect("serviceDateFrom" in page.vouchers[0]!).toBe(false);
      expect("serviceDateUntil" in page.vouchers[0]!).toBe(false);
    });
  });
});
