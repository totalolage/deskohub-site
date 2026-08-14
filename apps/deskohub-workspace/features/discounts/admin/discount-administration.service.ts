import {
  DotyposCustomerIdSchema,
  type DotyposDiscountGroupId,
  DotyposDiscountGroupIdSchema,
  DotyposService,
  type ExternalAPIError,
  type NetworkError,
  ValidationError,
} from "@deskohub/dotypos";
import type {
  Customer as DotyposCustomer,
  DiscountGroup as DotyposDiscountGroup,
} from "@deskohub/dotypos/generated";
import {
  type GoogleCalendarEventId,
  type GoogleCalendarICalUid,
  GoogleCalendarService,
} from "@deskohub/google-calendar";
import { and, eq, sql } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import {
  Context,
  Data,
  Effect,
  Layer,
  Match,
  Option,
  Predicate,
  Schema,
} from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";
import {
  WorkspaceDatabase,
  type WorkspaceDatabaseClient,
} from "@/db/database.service";
import {
  type DiscountCode,
  type DiscountCodeClaimState,
  type DiscountCodeRedemption,
  type DiscountLabels,
  type DiscountProductTarget,
  discountApplications,
  discountCodes,
  discountProductTargets,
  discounts,
  type PromotionCode,
  promotionCodeCustomers,
  promotionCodes,
  type StoredDiscount,
  type Voucher,
  type VoucherRedemption,
  voucherRedemptions,
  vouchers,
} from "@/db/schema";
import type { PaymentAttemptId } from "@/features/checkout/checkout-identifiers";
import type { WorkspaceMoney } from "@/features/checkout/workspace-money";
import type { WorkspaceProductTarget } from "@/features/discounts/product-target";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import {
  CalendarResourceConfig,
  type SalesCalendarId,
} from "@/shared/backend/config/calendar-resource.config";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import { WorkspaceGoogleCalendarLayer } from "@/shared/backend/config/google-calendar.config";
import { sensitiveDatabaseParameter } from "@/shared/backend/logging/database-query-parameter-classifier";
import { workspaceSiteConstants } from "@/shared/utils";
import type { DiscountAdjustment } from "../contracts";
import { toDotyposDiscountBasisPoints } from "../dotypos-discount-percentage";
import {
  type DiscountCodeClaimId,
  type DiscountCodeId,
  type StoredDiscountId,
  storedDiscountIdSchema,
  type VoucherClaimId,
  type VoucherId,
} from "../persistence-contracts";
import type {
  CreateCustomerDiscountCodeAdminInput,
  CreateCustomerVoucherAdminInput,
  CreateDiscountAdminInput,
  CreateManagedDiscountCodeAdminInput,
  CreateVoucherAdminInput,
  DiscountAdminCustomerSearch,
  UpdateDiscountAdminInput,
  UpdateDiscountCodeAdminInput,
  UpdateVoucherAdminInput,
} from "./contracts";

export type AdminDiscount = {
  readonly id: StoredDiscountId;
  readonly labels: DiscountLabels;
  readonly adjustment: DiscountAdjustment;
  readonly products: readonly WorkspaceProductTarget[];
  readonly codeCount: number;
  readonly createdAt: Temporal.Instant;
  readonly updatedAt: Temporal.Instant;
};

export type AdminDiscountCode = {
  readonly id: DiscountCodeId;
  readonly discountId: StoredDiscountId;
  readonly code: string;
  readonly enabled: boolean;
  readonly validFrom: Temporal.Instant | null;
  readonly validUntil: Temporal.Instant | null;
  readonly maxUses: number | null;
  readonly maxUsesPerCustomer: number | null;
  readonly audienceSize: number;
  readonly reservedUses: number;
  readonly redeemedUses: number;
  readonly releasedUses: number;
  readonly remainingUses: number | null;
  readonly createdAt: Temporal.Instant;
  readonly updatedAt: Temporal.Instant;
};

export type AdminVoucher = {
  readonly id: VoucherId;
  readonly issuedCredit: WorkspaceMoney;
  readonly remainingCredit: WorkspaceMoney;
  readonly code: string;
  readonly enabled: boolean;
  readonly validFrom: Temporal.Instant | null;
  readonly validUntil: Temporal.Instant | null;
  readonly audienceSize: number;
  readonly reservedUses: number;
  readonly redeemedUses: number;
  readonly releasedUses: number;
  readonly createdAt: Temporal.Instant;
  readonly updatedAt: Temporal.Instant;
};

export type AdminDotyposCustomer = {
  readonly id: DotyposCustomerId;
  readonly displayName: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly discountGroupId: DotyposDiscountGroupId | null;
};

export type AdminDiscountGroup = {
  readonly id: DotyposDiscountGroupId;
  readonly name: string;
  readonly basisPoints: number;
};

export type AdminDiscountCodeClaim = {
  readonly id: DiscountCodeClaimId;
  readonly codeId: DiscountCodeId;
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly state: DiscountCodeClaimState;
  readonly paymentAttemptId: PaymentAttemptId;
  readonly workspaceReservationId: WorkspaceReservationId;
  readonly appliedAmount: WorkspaceMoney;
  readonly reservationExpiresAt: Temporal.Instant;
  readonly reservedAt: Temporal.Instant;
  readonly redeemedAt: Temporal.Instant | null;
  readonly releasedAt: Temporal.Instant | null;
  readonly releaseReason: string | null;
};

export type AdminDiscountCodeDetail = {
  readonly code: AdminDiscountCode;
  readonly discountLabel: string;
  readonly customers: readonly {
    readonly customerId: DotyposCustomerId;
    readonly customer: AdminDotyposCustomer | null;
  }[];
  readonly claims: readonly AdminDiscountCodeClaim[];
};

export type AdminVoucherClaim = Omit<
  AdminDiscountCodeClaim,
  "id" | "codeId"
> & {
  readonly id: VoucherClaimId;
  readonly voucherId: VoucherId;
};

export type AdminVoucherDetail = {
  readonly voucher: AdminVoucher;
  readonly customers: AdminDiscountCodeDetail["customers"];
  readonly claims: readonly AdminVoucherClaim[];
};

export type AdminCustomerCode = AdminDiscountCode & {
  readonly discountAdjustment: DiscountAdjustment;
  readonly discountLabel: string;
  readonly eligible: boolean;
};

export type AdminCustomerProfile = {
  readonly customer: AdminDotyposCustomer;
  readonly discountGroups: readonly AdminDiscountGroup[];
  readonly codes: readonly AdminCustomerCode[];
  readonly claims: readonly AdminDiscountCodeClaim[];
  readonly vouchers: readonly (AdminVoucher & { readonly eligible: boolean })[];
  readonly voucherClaims: readonly AdminVoucherClaim[];
};

export type AdminCustomerCodeCreation = {
  readonly customer: AdminDotyposCustomer;
  readonly discounts: readonly Pick<AdminDiscount, "id" | "labels">[];
};

export type AdminCustomerSearchResult = {
  readonly kind: "matched" | "not-found" | "ambiguous";
  readonly customers: readonly AdminDotyposCustomer[];
};

export type AdminCalendarSale = {
  readonly eventReference?: GoogleCalendarEventId | GoogleCalendarICalUid;
  readonly title: string;
  readonly description: string;
  readonly start: string;
  readonly end: string;
  readonly status: string;
  readonly eventUrl: string;
  readonly association:
    | {
        readonly kind: "associated";
        readonly discountId: StoredDiscountId;
        readonly discountLabel: string;
      }
    | { readonly kind: "missing-description" }
    | { readonly kind: "invalid-description" }
    | {
        readonly kind: "missing-discount";
        readonly discountId: StoredDiscountId;
      };
};

export type DiscountAdminDashboard = {
  readonly discounts: readonly AdminDiscount[];
  readonly codes: readonly AdminDiscountCode[];
  readonly vouchers: readonly AdminVoucher[];
  readonly calendar: {
    readonly events: readonly AdminCalendarSale[];
    readonly unavailable: boolean;
    readonly calendarUrl: string;
    readonly from: string;
    readonly to: string;
  };
};

export type DiscountAdminCodesPage = Pick<
  DiscountAdminDashboard,
  "codes" | "discounts"
>;

export type DiscountAdminVouchersPage = Pick<
  DiscountAdminDashboard,
  "vouchers"
>;

export type DiscountAdminSalesPage = Pick<
  DiscountAdminDashboard,
  "calendar" | "discounts"
>;

export interface IDiscountAdministration {
  readonly loadDashboard: () => Effect.Effect<
    DiscountAdminDashboard,
    EffectDrizzleQueryError | SqlError
  >;
  readonly loadCodesPage: () => Effect.Effect<
    DiscountAdminCodesPage,
    EffectDrizzleQueryError | SqlError
  >;
  readonly loadVouchersPage: () => Effect.Effect<
    DiscountAdminVouchersPage,
    EffectDrizzleQueryError | SqlError
  >;
  readonly loadSalesPage: () => Effect.Effect<
    DiscountAdminSalesPage,
    EffectDrizzleQueryError | SqlError
  >;
  readonly createDiscount: (
    input: CreateDiscountAdminInput
  ) => Effect.Effect<StoredDiscountId, EffectDrizzleQueryError | SqlError>;
  readonly updateDiscount: (
    input: UpdateDiscountAdminInput
  ) => Effect.Effect<
    void,
    EffectDrizzleQueryError | SqlError | DiscountAdminNotFoundError
  >;
  readonly deleteDiscount: (
    input: DeleteDiscountInput
  ) => Effect.Effect<
    void,
    | EffectDrizzleQueryError
    | SqlError
    | DiscountAdminNotFoundError
    | DiscountAdminConflictError
  >;
  readonly createCode: (
    input: CreateManagedDiscountCodeAdminInput
  ) => Effect.Effect<
    DiscountCodeId,
    | EffectDrizzleQueryError
    | SqlError
    | DiscountAdminNotFoundError
    | DiscountAdminConflictError
  >;
  readonly createCustomerCode: (
    input: CreateCustomerDiscountCodeAdminInput
  ) => Effect.Effect<
    DiscountCodeId,
    | EffectDrizzleQueryError
    | SqlError
    | ExternalAPIError
    | NetworkError
    | ValidationError
    | DiscountAdminNotFoundError
    | DiscountAdminConflictError
  >;
  readonly updateCode: (
    input: UpdateDiscountCodeAdminInput
  ) => Effect.Effect<
    void,
    | EffectDrizzleQueryError
    | SqlError
    | DiscountAdminNotFoundError
    | DiscountAdminConflictError
  >;
  readonly deleteCode: (
    input: DeleteCodeInput
  ) => Effect.Effect<
    void,
    | EffectDrizzleQueryError
    | SqlError
    | DiscountAdminNotFoundError
    | DiscountAdminConflictError
  >;
  readonly createVoucher: (
    input: CreateVoucherAdminInput
  ) => Effect.Effect<
    VoucherId,
    EffectDrizzleQueryError | SqlError | DiscountAdminConflictError
  >;
  readonly createCustomerVoucher: (
    input: CreateCustomerVoucherAdminInput
  ) => Effect.Effect<
    VoucherId,
    | EffectDrizzleQueryError
    | SqlError
    | ExternalAPIError
    | NetworkError
    | ValidationError
    | DiscountAdminNotFoundError
    | DiscountAdminConflictError
  >;
  readonly updateVoucher: (
    input: UpdateVoucherAdminInput
  ) => Effect.Effect<
    void,
    | EffectDrizzleQueryError
    | SqlError
    | DiscountAdminNotFoundError
    | DiscountAdminConflictError
  >;
  readonly deleteVoucher: (input: {
    readonly id: VoucherId;
  }) => Effect.Effect<
    void,
    | EffectDrizzleQueryError
    | SqlError
    | DiscountAdminNotFoundError
    | DiscountAdminConflictError
  >;
  readonly loadVoucherDetail: (input: {
    readonly voucherId: VoucherId;
  }) => Effect.Effect<
    AdminVoucherDetail,
    EffectDrizzleQueryError | SqlError | DiscountAdminNotFoundError
  >;
  readonly loadCodeDetail: (input: {
    readonly codeId: DiscountCodeId;
  }) => Effect.Effect<
    AdminDiscountCodeDetail,
    EffectDrizzleQueryError | SqlError | DiscountAdminNotFoundError
  >;
  readonly searchCustomers: (
    input: DiscountAdminCustomerSearch
  ) => Effect.Effect<
    AdminCustomerSearchResult,
    ExternalAPIError | NetworkError | ValidationError
  >;
  readonly loadCustomerProfile: (input: {
    readonly customerId: DotyposCustomerId;
  }) => Effect.Effect<
    AdminCustomerProfile,
    | EffectDrizzleQueryError
    | SqlError
    | ExternalAPIError
    | NetworkError
    | ValidationError
    | DiscountAdminNotFoundError
  >;
  readonly loadCustomerBreadcrumbLabel: (input: {
    readonly customerId: DotyposCustomerId;
  }) => Effect.Effect<
    string,
    | ExternalAPIError
    | NetworkError
    | ValidationError
    | DiscountAdminNotFoundError
  >;
  readonly loadCustomerCodeCreation: (input: {
    readonly customerId: DotyposCustomerId;
  }) => Effect.Effect<
    AdminCustomerCodeCreation,
    | EffectDrizzleQueryError
    | SqlError
    | ExternalAPIError
    | NetworkError
    | ValidationError
    | DiscountAdminNotFoundError
  >;
  readonly addCodeCustomer: (input: {
    readonly codeId: DiscountCodeId;
    readonly customerId: DotyposCustomerId;
  }) => Effect.Effect<
    void,
    | EffectDrizzleQueryError
    | SqlError
    | ExternalAPIError
    | NetworkError
    | ValidationError
    | DiscountAdminNotFoundError
  >;
  readonly removeCodeCustomer: (input: {
    readonly codeId: DiscountCodeId;
    readonly customerId: DotyposCustomerId;
  }) => Effect.Effect<
    void,
    | EffectDrizzleQueryError
    | SqlError
    | DiscountAdminNotFoundError
    | DiscountAdminAudienceError
  >;
  readonly makeCodeUnrestricted: (input: {
    readonly codeId: DiscountCodeId;
  }) => Effect.Effect<
    void,
    EffectDrizzleQueryError | SqlError | DiscountAdminNotFoundError
  >;
  readonly addVoucherCustomer: (input: {
    readonly voucherId: VoucherId;
    readonly customerId: DotyposCustomerId;
  }) => Effect.Effect<
    void,
    | EffectDrizzleQueryError
    | SqlError
    | ExternalAPIError
    | NetworkError
    | ValidationError
    | DiscountAdminNotFoundError
  >;
  readonly removeVoucherCustomer: (input: {
    readonly voucherId: VoucherId;
    readonly customerId: DotyposCustomerId;
  }) => Effect.Effect<
    void,
    | EffectDrizzleQueryError
    | SqlError
    | DiscountAdminNotFoundError
    | DiscountAdminAudienceError
  >;
  readonly makeVoucherUnrestricted: (input: {
    readonly voucherId: VoucherId;
  }) => Effect.Effect<
    void,
    EffectDrizzleQueryError | SqlError | DiscountAdminNotFoundError
  >;
  readonly setCustomerDiscountGroup: (input: {
    readonly customerId: DotyposCustomerId;
    readonly discountGroupId: DotyposDiscountGroupId | null;
  }) => Effect.Effect<
    void,
    | ExternalAPIError
    | NetworkError
    | ValidationError
    | DiscountAdminNotFoundError
  >;
}

type DeleteDiscountInput = {
  readonly id: StoredDiscountId;
};

type DeleteCodeInput = {
  readonly id: DiscountCodeId;
};

export class DiscountAdministration extends Context.Service<
  DiscountAdministration,
  IDiscountAdministration
>()("@deskohub-workspace/discounts/DiscountAdministration") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;
      const calendar = yield* GoogleCalendarService;
      const dotypos = yield* DotyposService;
      const { salesCalendarId } = yield* CalendarResourceConfig;

      const loadActiveCustomer = Effect.fn(
        "DiscountAdministration.loadActiveCustomer"
      )((customerId: DotyposCustomerId) =>
        dotypos.getCustomer(customerId).pipe(
          Effect.catchTag("ExternalAPIError", (error) =>
            Effect.fail(
              error.statusCode === 404
                ? new DiscountAdminNotFoundError({
                    resource: { kind: "Dotypos customer", id: customerId },
                    message:
                      "The Dotypos customer does not exist or is deleted.",
                  })
                : error
            )
          ),
          Effect.filterOrFail(
            (customer) => Boolean(customer.id) && !customer.deleted,
            () =>
              new DiscountAdminNotFoundError({
                resource: { kind: "Dotypos customer", id: customerId },
                message: "The Dotypos customer does not exist or is deleted.",
              })
          )
        )
      );

      const loadDiscounts = Effect.fn("DiscountAdministration.loadDiscounts")(
        () =>
          db.query.discounts
            .findMany({
              with: {
                codes: {},
                productTargets: {},
              },
            })
            .pipe(
              Effect.map((rows) =>
                rows
                  .map(toAdminDiscount)
                  .toSorted((left, right) =>
                    (left.labels["en-US"] ?? "").localeCompare(
                      right.labels["en-US"] ?? ""
                    )
                  )
              )
            )
      );

      const loadCodes = Effect.fn("DiscountAdministration.loadCodes")(() =>
        db.query.discountCodes
          .findMany({
            with: {
              promotion: { with: { customers: {} } },
              redemptions: { with: { application: {} } },
            },
          })
          .pipe(
            Effect.map((rows) =>
              rows
                .map(toAdminDiscountCode)
                .toSorted((left, right) => left.code.localeCompare(right.code))
            )
          )
      );

      const loadVouchers = Effect.fn("DiscountAdministration.loadVouchers")(
        () =>
          db.query.vouchers
            .findMany({
              with: {
                promotion: { with: { customers: {} } },
                redemptions: { with: { application: {} } },
              },
            })
            .pipe(
              Effect.map((rows) =>
                rows
                  .map(toAdminVoucher)
                  .toSorted((left, right) =>
                    left.code.localeCompare(right.code)
                  )
              )
            )
      );

      const loadCodesPage = Effect.fn("DiscountAdministration.loadCodesPage")(
        () =>
          Effect.all(
            {
              codes: loadCodes(),
              discounts: loadDiscounts(),
            },
            { concurrency: 2 }
          )
      );

      const loadVouchersPage = Effect.fn(
        "DiscountAdministration.loadVouchersPage"
      )(() => loadVouchers().pipe(Effect.map((vouchers) => ({ vouchers }))));

      const loadSalesPage = Effect.fn("DiscountAdministration.loadSalesPage")(
        () =>
          loadDiscounts().pipe(
            Effect.flatMap((discounts) =>
              loadCalendarDashboard({
                calendar,
                discounts,
                salesCalendarId,
              }).pipe(Effect.map((calendar) => ({ calendar, discounts })))
            )
          )
      );

      const loadDashboard = Effect.fn("DiscountAdministration.loadDashboard")(
        () =>
          Effect.all({
            codesPage: loadCodesPage(),
            vouchers: loadVouchers(),
          }).pipe(
            Effect.map(({ codesPage, vouchers }) => ({
              ...codesPage,
              vouchers,
            })),
            Effect.bind("calendar", ({ discounts }) =>
              loadCalendarDashboard({
                calendar,
                discounts,
                salesCalendarId,
              })
            ),
            Effect.map(({ calendar, codes, discounts, vouchers }) => ({
              calendar,
              codes,
              discounts,
              vouchers,
            }))
          )
      );

      const createDiscount = Effect.fn("DiscountAdministration.createDiscount")(
        (input: CreateDiscountAdminInput) =>
          db.transaction((tx) =>
            Effect.gen(function* () {
              const rows = yield* tx
                .insert(discounts)
                .values(toDiscountValues(input))
                .returning({ id: discounts.id });
              const row = rows[0];
              if (!row) {
                return yield* Effect.die(
                  new Error("Discount insert returned no identifier.")
                );
              }
              yield* tx
                .insert(discountProductTargets)
                .values(toDiscountProductTargetRows(row.id, input.products));
              return row.id;
            })
          )
      );

      const updateDiscount = Effect.fn("DiscountAdministration.updateDiscount")(
        (input: UpdateDiscountAdminInput) =>
          db.transaction((tx) =>
            Effect.gen(function* () {
              const rows = yield* tx
                .update(discounts)
                .set({
                  ...toDiscountValues(input),
                  updatedAt: Temporal.Now.instant(),
                })
                .where(eq(discounts.id, input.id))
                .returning({ id: discounts.id });
              yield* requireUpdatedRow(rows, {
                kind: "discount",
                id: input.id,
              });
              yield* tx
                .delete(discountProductTargets)
                .where(eq(discountProductTargets.discountId, input.id));
              yield* tx
                .insert(discountProductTargets)
                .values(toDiscountProductTargetRows(input.id, input.products));
            })
          )
      );

      const deleteDiscount = Effect.fn("DiscountAdministration.deleteDiscount")(
        (input: DeleteDiscountInput) =>
          db
            .delete(discounts)
            .where(eq(discounts.id, input.id))
            .returning({ id: discounts.id })
            .pipe(
              Effect.flatMap((rows) =>
                requireUpdatedRow(rows, { kind: "discount", id: input.id })
              )
            )
      );

      const createCode = Effect.fn("DiscountAdministration.createCode")(
        (input: CreateManagedDiscountCodeAdminInput) =>
          db.transaction((tx) =>
            Effect.gen(function* () {
              const discountId = yield* Match.value(input.discount).pipe(
                Match.discriminatorsExhaustive("kind")({
                  existing: ({ discountId }) =>
                    tx
                      .select({ id: discounts.id })
                      .from(discounts)
                      .where(eq(discounts.id, discountId))
                      .for("update")
                      .pipe(
                        Effect.flatMap((rows) =>
                          requireUpdatedRow(rows, {
                            kind: "discount",
                            id: discountId,
                          })
                        ),
                        Effect.as(discountId)
                      ),
                  new: ({ discount }) =>
                    Effect.gen(function* () {
                      const rows = yield* tx
                        .insert(discounts)
                        .values(toDiscountValues(discount))
                        .returning({ id: discounts.id });
                      const row = rows[0];
                      if (!row) {
                        return yield* Effect.die(
                          new Error("Discount insert returned no identifier.")
                        );
                      }
                      yield* tx
                        .insert(discountProductTargets)
                        .values(
                          toDiscountProductTargetRows(row.id, discount.products)
                        );
                      return row.id;
                    }),
                })
              );
              const [promotion] = yield* tx
                .insert(promotionCodes)
                .values({
                  kind: "discount",
                  ...toPromotionCodeValues(input.code),
                })
                .returning({ id: promotionCodes.id });
              if (!promotion) {
                return yield* Effect.die(
                  new Error("Promotion insert returned no identifier.")
                );
              }
              const codeRows = yield* tx
                .insert(discountCodes)
                .values({
                  ...toPromotionCodeValues(input.code),
                  promotionCodeId: promotion.id,
                  discountId,
                  maxUses: input.code.maxUses,
                  maxUsesPerCustomer: input.code.maxUsesPerCustomer ?? null,
                })
                .returning({ id: discountCodes.id });
              const codeRow = codeRows[0];
              return codeRow
                ? codeRow.id
                : yield* Effect.die(
                    new Error("Discount code insert returned no identifier.")
                  );
            })
          )
      );

      const createCustomerCode = Effect.fn(
        "DiscountAdministration.createCustomerCode"
      )(function* (input: CreateCustomerDiscountCodeAdminInput) {
        yield* loadActiveCustomer(input.customerId);

        return yield* db.transaction((tx) =>
          Effect.gen(function* () {
            const discountId = yield* Match.value(input.discount).pipe(
              Match.discriminatorsExhaustive("kind")({
                existing: ({ discountId }) =>
                  tx
                    .select({ id: discounts.id })
                    .from(discounts)
                    .where(eq(discounts.id, discountId))
                    .for("update")
                    .pipe(
                      Effect.flatMap((rows) =>
                        requireUpdatedRow(rows, {
                          kind: "discount",
                          id: discountId,
                        })
                      ),
                      Effect.as(discountId)
                    ),
                new: ({ discount }) =>
                  Effect.gen(function* () {
                    const rows = yield* tx
                      .insert(discounts)
                      .values(toDiscountValues(discount))
                      .returning({ id: discounts.id });
                    const row = rows[0];
                    if (!row) {
                      return yield* Effect.die(
                        new Error("Discount insert returned no identifier.")
                      );
                    }
                    yield* tx
                      .insert(discountProductTargets)
                      .values(
                        toDiscountProductTargetRows(row.id, discount.products)
                      );
                    return row.id;
                  }),
              })
            );
            const [promotion] = yield* tx
              .insert(promotionCodes)
              .values({
                kind: "discount",
                ...toPromotionCodeValues(input.code),
              })
              .returning({ id: promotionCodes.id });
            if (!promotion) {
              return yield* Effect.die(
                new Error("Promotion insert returned no identifier.")
              );
            }
            const codeRows = yield* tx
              .insert(discountCodes)
              .values({
                ...toPromotionCodeValues(input.code),
                promotionCodeId: promotion.id,
                discountId,
                maxUses: input.code.maxUses,
                maxUsesPerCustomer: input.code.maxUsesPerCustomer ?? null,
              })
              .returning({ id: discountCodes.id });
            const codeRow = codeRows[0];
            if (!codeRow) {
              return yield* Effect.die(
                new Error("Discount code insert returned no identifier.")
              );
            }
            yield* tx.insert(promotionCodeCustomers).values({
              promotionCodeId: promotion.id,
              dotyposCustomerId: input.customerId,
            });
            return codeRow.id;
          })
        );
      });

      const updateCode = Effect.fn("DiscountAdministration.updateCode")(
        (input: UpdateDiscountCodeAdminInput) =>
          db.transaction((tx) =>
            Effect.gen(function* () {
              const rows = yield* tx
                .select({
                  id: discountCodes.id,
                  promotionCodeId: discountCodes.promotionCodeId,
                })
                .from(discountCodes)
                .where(eq(discountCodes.id, input.id))
                .limit(1)
                .for("update");
              yield* requireUpdatedRow(rows, {
                kind: "discount code",
                id: input.id,
              });
              yield* tx
                .update(discountCodes)
                .set({
                  ...toPromotionCodeValues(input),
                  discountId: input.discountId,
                  maxUses: input.maxUses,
                  ...(input.maxUsesPerCustomer !== undefined && {
                    maxUsesPerCustomer: input.maxUsesPerCustomer,
                  }),
                  updatedAt: Temporal.Now.instant(),
                })
                .where(eq(discountCodes.id, input.id));
              yield* tx
                .update(promotionCodes)
                .set({
                  ...toPromotionCodeValues(input),
                  updatedAt: Temporal.Now.instant(),
                })
                .where(eq(promotionCodes.id, rows[0]!.promotionCodeId));
            })
          )
      );

      const deleteCode = Effect.fn("DiscountAdministration.deleteCode")(
        (input: DeleteCodeInput) =>
          db.transaction((tx) =>
            tx
              .select({
                id: discountCodes.id,
                promotionCodeId: discountCodes.promotionCodeId,
              })
              .from(discountCodes)
              .where(eq(discountCodes.id, input.id))
              .for("update")
              .pipe(
                Effect.flatMap((rows) =>
                  requireUpdatedRow(rows, {
                    kind: "discount code",
                    id: input.id,
                  })
                ),
                Effect.flatMap((row) =>
                  tx
                    .delete(promotionCodes)
                    .where(eq(promotionCodes.id, row.promotionCodeId))
                )
              )
          )
      );

      const loadCodeDetail = Effect.fn("DiscountAdministration.loadCodeDetail")(
        (input: { readonly codeId: DiscountCodeId }) =>
          db.query.discountCodes
            .findFirst({
              where: { id: { eq: input.codeId } },
              with: {
                promotion: { with: { customers: {} } },
                discount: {},
                redemptions: {
                  with: {
                    application: {},
                  },
                },
              },
            })
            .pipe(
              Effect.flatMap((row) =>
                row
                  ? Effect.succeed(row)
                  : Effect.fail(
                      new DiscountAdminNotFoundError({
                        resource: {
                          kind: "discount code",
                          id: input.codeId,
                        },
                        message: "The discount code no longer exists.",
                      })
                    )
              ),
              Effect.bindTo("row"),
              Effect.bind("customers", ({ row }) =>
                Effect.forEach(
                  row.promotion.customers,
                  ({ dotyposCustomerId }) =>
                    dotypos.getCustomer(dotyposCustomerId).pipe(
                      Effect.map(toAdminDotyposCustomer),
                      Effect.orElseSucceed(() => null),
                      Effect.map((customer) => ({
                        customerId: dotyposCustomerId,
                        customer,
                      }))
                    ),
                  { concurrency: 5 }
                )
              ),
              Effect.map(({ customers, row }) => ({
                code: toAdminDiscountCode(row),
                discountLabel: row.discount.labels["en-US"],
                customers,
                claims: row.redemptions
                  .map(toAdminDiscountCodeClaim)
                  .toSorted((left, right) =>
                    Temporal.Instant.compare(right.reservedAt, left.reservedAt)
                  ),
              }))
            )
      );

      const insertVoucher = Effect.fn("DiscountAdministration.insertVoucher")(
        function* (tx: TransactionClient, input: CreateVoucherAdminInput) {
          const [promotion] = yield* tx
            .insert(promotionCodes)
            .values({ kind: "voucher", ...toPromotionCodeValues(input) })
            .returning({ id: promotionCodes.id });
          if (!promotion) {
            return yield* Effect.die(
              new Error("Promotion insert returned no identifier.")
            );
          }
          const [voucher] = yield* tx
            .insert(vouchers)
            .values({
              promotionCodeId: promotion.id,
              issuedAmountValue: input.credit.value,
              issuedAmountExponent: input.credit.exponent,
              issuedAmountCurrency: input.credit.currency,
            })
            .returning({ id: vouchers.id });
          if (!voucher) {
            return yield* Effect.die(
              new Error("Voucher insert returned no identifier.")
            );
          }
          return { promotionCodeId: promotion.id, voucherId: voucher.id };
        }
      );

      const createVoucher = Effect.fn("DiscountAdministration.createVoucher")(
        (input: CreateVoucherAdminInput) =>
          db.transaction((tx) =>
            insertVoucher(tx, input).pipe(
              Effect.map(({ voucherId }) => voucherId)
            )
          )
      );

      const createCustomerVoucher = Effect.fn(
        "DiscountAdministration.createCustomerVoucher"
      )(function* (input: CreateCustomerVoucherAdminInput) {
        yield* loadActiveCustomer(input.customerId);
        return yield* db.transaction((tx) =>
          Effect.gen(function* () {
            const created = yield* insertVoucher(tx, input);
            yield* tx.insert(promotionCodeCustomers).values({
              promotionCodeId: created.promotionCodeId,
              dotyposCustomerId: input.customerId,
            });
            return created.voucherId;
          })
        );
      });

      const updateVoucher = Effect.fn("DiscountAdministration.updateVoucher")(
        (input: UpdateVoucherAdminInput) =>
          db.transaction((tx) =>
            Effect.gen(function* () {
              const row = yield* tx
                .select()
                .from(vouchers)
                .where(eq(vouchers.id, input.id))
                .limit(1)
                .for("update")
                .pipe(
                  Effect.flatMap((rows) =>
                    requireUpdatedRow(rows, { kind: "voucher", id: input.id })
                  )
                );
              const [usage] = yield* tx
                .select({
                  claimCount: sql<number>`count(*)::integer`,
                  value: sql<number>`coalesce(sum(${discountApplications.appliedAmountValue}) filter (where ${voucherRedemptions.state} in ('reserved', 'redeemed')), 0)::integer`,
                })
                .from(voucherRedemptions)
                .innerJoin(
                  discountApplications,
                  eq(discountApplications.id, voucherRedemptions.applicationId)
                )
                .where(eq(voucherRedemptions.voucherId, input.id));
              const usedValue = usage?.value ?? 0;
              if (usedValue > input.credit.value) {
                return yield* new DiscountAdminConflictError({
                  message:
                    "Voucher credit cannot be lower than its reserved and redeemed value.",
                });
              }
              if (
                !voucherDenominationCanChange({
                  claimCount: usage?.claimCount ?? 0,
                  current: {
                    exponent: row.issuedAmountExponent,
                    currency: row.issuedAmountCurrency,
                  },
                  updated: input.credit,
                })
              ) {
                return yield* new DiscountAdminConflictError({
                  message:
                    "Voucher currency cannot change after it has claim history.",
                });
              }
              const updatedAt = Temporal.Now.instant();
              yield* tx
                .update(vouchers)
                .set({
                  issuedAmountValue: input.credit.value,
                  issuedAmountExponent: input.credit.exponent,
                  issuedAmountCurrency: input.credit.currency,
                  updatedAt,
                })
                .where(eq(vouchers.id, input.id));
              yield* tx
                .update(promotionCodes)
                .set({ ...toPromotionCodeValues(input), updatedAt })
                .where(eq(promotionCodes.id, row.promotionCodeId));
            })
          )
      );

      const deleteVoucher = Effect.fn("DiscountAdministration.deleteVoucher")(
        (input: { readonly id: VoucherId }) =>
          db.transaction((tx) =>
            tx
              .select({
                id: vouchers.id,
                promotionCodeId: vouchers.promotionCodeId,
              })
              .from(vouchers)
              .where(eq(vouchers.id, input.id))
              .for("update")
              .pipe(
                Effect.flatMap((rows) =>
                  requireUpdatedRow(rows, { kind: "voucher", id: input.id })
                ),
                Effect.flatMap((row) =>
                  tx
                    .delete(promotionCodes)
                    .where(eq(promotionCodes.id, row.promotionCodeId))
                )
              )
          )
      );

      const loadVoucherDetail = Effect.fn(
        "DiscountAdministration.loadVoucherDetail"
      )((input: { readonly voucherId: VoucherId }) =>
        db.query.vouchers
          .findFirst({
            where: { id: { eq: input.voucherId } },
            with: {
              promotion: { with: { customers: {} } },
              redemptions: { with: { application: {} } },
            },
          })
          .pipe(
            Effect.flatMap((row) =>
              row
                ? Effect.succeed(row)
                : Effect.fail(
                    new DiscountAdminNotFoundError({
                      resource: { kind: "voucher", id: input.voucherId },
                      message: "The voucher no longer exists.",
                    })
                  )
            ),
            Effect.bindTo("row"),
            Effect.bind("customers", ({ row }) =>
              Effect.forEach(
                row.promotion.customers,
                ({ dotyposCustomerId }) =>
                  dotypos.getCustomer(dotyposCustomerId).pipe(
                    Effect.map(toAdminDotyposCustomer),
                    Effect.orElseSucceed(() => null),
                    Effect.map((customer) => ({
                      customerId: dotyposCustomerId,
                      customer,
                    }))
                  ),
                { concurrency: 5 }
              )
            ),
            Effect.map(({ customers, row }) => ({
              voucher: toAdminVoucher(row),
              customers,
              claims: row.redemptions
                .map(toAdminVoucherClaim)
                .toSorted((left, right) =>
                  Temporal.Instant.compare(right.reservedAt, left.reservedAt)
                ),
            }))
          )
      );

      const searchCustomers = Effect.fn(
        "DiscountAdministration.searchCustomers"
      )(function* (input: DiscountAdminCustomerSearch) {
        const customers = (yield* dotypos.searchCustomers(input.query))
          .filter((customer) => customer.id && !customer.deleted)
          .map(toAdminDotyposCustomer)
          .slice(0, 50);
        let kind: AdminCustomerSearchResult["kind"] = "not-found";
        if (customers.length === 1) kind = "matched";
        else if (customers.length > 1) kind = "ambiguous";
        return {
          kind,
          customers,
        } satisfies AdminCustomerSearchResult;
      });

      const loadCustomerProfile = Effect.fn(
        "DiscountAdministration.loadCustomerProfile"
      )((input: { readonly customerId: DotyposCustomerId }) =>
        Effect.all({
          customer: loadActiveCustomer(input.customerId),
          discountGroups: dotypos.getDiscountGroups(),
          codeRows: db.query.discountCodes.findMany({
            with: {
              promotion: { with: { customers: {} } },
              discount: {},
              redemptions: {
                with: {
                  application: {},
                },
              },
            },
          }),
          voucherRows: db.query.vouchers.findMany({
            with: {
              promotion: { with: { customers: {} } },
              redemptions: { with: { application: {} } },
            },
          }),
        }).pipe(
          Effect.map(({ codeRows, customer, discountGroups, voucherRows }) => ({
            customer: toAdminDotyposCustomer(customer),
            discountGroups: discountGroups
              .flatMap(toAdminDiscountGroup)
              .toSorted((left, right) => left.name.localeCompare(right.name)),
            codes: codeRows
              .map((row) => ({
                ...toAdminDiscountCode(row),
                discountAdjustment: toDiscountAdjustment(row.discount),
                discountLabel: row.discount.labels["en-US"],
                eligible: row.promotion.customers.some(
                  ({ dotyposCustomerId }) =>
                    dotyposCustomerId === input.customerId
                ),
              }))
              .toSorted((left, right) => left.code.localeCompare(right.code)),
            claims: codeRows
              .flatMap((row) =>
                row.redemptions
                  .filter(
                    ({ dotyposCustomerId }) =>
                      dotyposCustomerId === input.customerId
                  )
                  .map(toAdminDiscountCodeClaim)
              )
              .toSorted((left, right) =>
                Temporal.Instant.compare(right.reservedAt, left.reservedAt)
              ),
            vouchers: voucherRows
              .map((row) => ({
                ...toAdminVoucher(row),
                eligible: row.promotion.customers.some(
                  ({ dotyposCustomerId }) =>
                    dotyposCustomerId === input.customerId
                ),
              }))
              .toSorted((left, right) => left.code.localeCompare(right.code)),
            voucherClaims: voucherRows
              .flatMap((row) =>
                row.redemptions
                  .filter(
                    ({ dotyposCustomerId }) =>
                      dotyposCustomerId === input.customerId
                  )
                  .map(toAdminVoucherClaim)
              )
              .toSorted((left, right) =>
                Temporal.Instant.compare(right.reservedAt, left.reservedAt)
              ),
          }))
        )
      );

      const loadCustomerBreadcrumbLabel = Effect.fn(
        "DiscountAdministration.loadCustomerBreadcrumbLabel"
      )((input: { readonly customerId: DotyposCustomerId }) =>
        loadActiveCustomer(input.customerId).pipe(
          Effect.map((customer) => toAdminDotyposCustomer(customer).displayName)
        )
      );

      const loadCustomerCodeCreation = Effect.fn(
        "DiscountAdministration.loadCustomerCodeCreation"
      )((input: { readonly customerId: DotyposCustomerId }) =>
        Effect.all(
          {
            customer: loadActiveCustomer(input.customerId),
            discounts: loadDiscounts(),
          },
          { concurrency: "inherit" }
        ).pipe(
          Effect.map(({ customer, discounts }) => ({
            customer: toAdminDotyposCustomer(customer),
            discounts: discounts.map(({ id, labels }) => ({ id, labels })),
          }))
        )
      );

      const addCodeCustomer = Effect.fn(
        "DiscountAdministration.addCodeCustomer"
      )(function* (input: {
        readonly codeId: DiscountCodeId;
        readonly customerId: DotyposCustomerId;
      }) {
        yield* loadActiveCustomer(input.customerId);

        yield* db.transaction((tx) =>
          Effect.gen(function* () {
            const codeRows = yield* tx
              .select({
                id: discountCodes.id,
                promotionCodeId: discountCodes.promotionCodeId,
              })
              .from(discountCodes)
              .where(eq(discountCodes.id, input.codeId))
              .for("update");
            const code = yield* requireUpdatedRow(codeRows, {
              kind: "discount code",
              id: input.codeId,
            });
            yield* tx
              .insert(promotionCodeCustomers)
              .values({
                promotionCodeId: code.promotionCodeId,
                dotyposCustomerId: input.customerId,
              })
              .onConflictDoNothing();
          })
        );
      });

      const removeCodeCustomer = Effect.fn(
        "DiscountAdministration.removeCodeCustomer"
      )(
        (input: {
          readonly codeId: DiscountCodeId;
          readonly customerId: DotyposCustomerId;
        }) =>
          db.transaction((tx) =>
            Effect.gen(function* () {
              const codeRows = yield* tx
                .select({
                  id: discountCodes.id,
                  promotionCodeId: discountCodes.promotionCodeId,
                })
                .from(discountCodes)
                .where(eq(discountCodes.id, input.codeId))
                .for("update");
              const code = yield* requireUpdatedRow(codeRows, {
                kind: "discount code",
                id: input.codeId,
              });
              const audience = yield* tx
                .select({
                  customerId: promotionCodeCustomers.dotyposCustomerId,
                })
                .from(promotionCodeCustomers)
                .where(
                  eq(
                    promotionCodeCustomers.promotionCodeId,
                    code.promotionCodeId
                  )
                );
              if (
                !audience.some(
                  ({ customerId }) => customerId === input.customerId
                )
              ) {
                return yield* new DiscountAdminNotFoundError({
                  resource: {
                    kind: "code audience membership",
                    id: input.customerId,
                  },
                  message: "This customer is no longer in the code audience.",
                });
              }
              if (audience.length === 1) {
                return yield* new DiscountAdminAudienceError({
                  message:
                    "Removing the final customer would make this code unrestricted. Use Make unrestricted instead.",
                });
              }
              yield* tx
                .delete(promotionCodeCustomers)
                .where(
                  and(
                    eq(
                      promotionCodeCustomers.promotionCodeId,
                      code.promotionCodeId
                    ),
                    eq(
                      promotionCodeCustomers.dotyposCustomerId,
                      input.customerId
                    )
                  )
                );
            })
          )
      );

      const makeCodeUnrestricted = Effect.fn(
        "DiscountAdministration.makeCodeUnrestricted"
      )((input: { readonly codeId: DiscountCodeId }) =>
        db.transaction((tx) =>
          Effect.gen(function* () {
            const codeRows = yield* tx
              .select({
                id: discountCodes.id,
                promotionCodeId: discountCodes.promotionCodeId,
              })
              .from(discountCodes)
              .where(eq(discountCodes.id, input.codeId))
              .for("update");
            const code = yield* requireUpdatedRow(codeRows, {
              kind: "discount code",
              id: input.codeId,
            });
            yield* tx
              .delete(promotionCodeCustomers)
              .where(
                eq(promotionCodeCustomers.promotionCodeId, code.promotionCodeId)
              );
          })
        )
      );

      const loadVoucherPromotionId = Effect.fn(
        "DiscountAdministration.loadVoucherPromotionId"
      )((tx: TransactionClient, voucherId: VoucherId) =>
        tx
          .select({
            id: vouchers.id,
            promotionCodeId: vouchers.promotionCodeId,
          })
          .from(vouchers)
          .where(eq(vouchers.id, voucherId))
          .for("update")
          .pipe(
            Effect.flatMap((rows) =>
              requireUpdatedRow(rows, { kind: "voucher", id: voucherId })
            ),
            Effect.map(({ promotionCodeId }) => promotionCodeId)
          )
      );

      const addVoucherCustomer = Effect.fn(
        "DiscountAdministration.addVoucherCustomer"
      )(function* (input: {
        readonly voucherId: VoucherId;
        readonly customerId: DotyposCustomerId;
      }) {
        yield* loadActiveCustomer(input.customerId);
        yield* db.transaction((tx) =>
          loadVoucherPromotionId(tx, input.voucherId).pipe(
            Effect.flatMap((promotionCodeId) =>
              tx
                .insert(promotionCodeCustomers)
                .values({
                  promotionCodeId,
                  dotyposCustomerId: input.customerId,
                })
                .onConflictDoNothing()
            )
          )
        );
      });

      const removeVoucherCustomer = Effect.fn(
        "DiscountAdministration.removeVoucherCustomer"
      )(
        (input: {
          readonly voucherId: VoucherId;
          readonly customerId: DotyposCustomerId;
        }) =>
          db.transaction((tx) =>
            Effect.gen(function* () {
              const promotionCodeId = yield* loadVoucherPromotionId(
                tx,
                input.voucherId
              );
              const audience = yield* tx
                .select({
                  customerId: promotionCodeCustomers.dotyposCustomerId,
                })
                .from(promotionCodeCustomers)
                .where(
                  eq(promotionCodeCustomers.promotionCodeId, promotionCodeId)
                );
              if (
                !audience.some(
                  ({ customerId }) => customerId === input.customerId
                )
              ) {
                return yield* new DiscountAdminNotFoundError({
                  resource: {
                    kind: "voucher audience membership",
                    id: input.customerId,
                  },
                  message:
                    "This customer is no longer in the voucher audience.",
                });
              }
              if (audience.length === 1) {
                return yield* new DiscountAdminAudienceError({
                  message:
                    "Removing the final customer would make this voucher unrestricted. Use Make unrestricted instead.",
                });
              }
              yield* tx
                .delete(promotionCodeCustomers)
                .where(
                  and(
                    eq(promotionCodeCustomers.promotionCodeId, promotionCodeId),
                    eq(
                      promotionCodeCustomers.dotyposCustomerId,
                      input.customerId
                    )
                  )
                );
            })
          )
      );

      const makeVoucherUnrestricted = Effect.fn(
        "DiscountAdministration.makeVoucherUnrestricted"
      )((input: { readonly voucherId: VoucherId }) =>
        db.transaction((tx) =>
          loadVoucherPromotionId(tx, input.voucherId).pipe(
            Effect.flatMap((promotionCodeId) =>
              tx
                .delete(promotionCodeCustomers)
                .where(
                  eq(promotionCodeCustomers.promotionCodeId, promotionCodeId)
                )
            )
          )
        )
      );

      const setCustomerDiscountGroup = Effect.fn(
        "DiscountAdministration.setCustomerDiscountGroup"
      )(function* (input: {
        readonly customerId: DotyposCustomerId;
        readonly discountGroupId: DotyposDiscountGroupId | null;
      }) {
        const customer = yield* loadActiveCustomer(input.customerId);
        if (input.discountGroupId !== null) {
          if (customer._discountGroupId === input.discountGroupId) {
            return;
          }
          const discountGroups = yield* dotypos.getDiscountGroups();
          const group = discountGroups.find(
            ({ id }) => id === input.discountGroupId
          );
          if (!group || group.deleted || group.display === false) {
            return yield* new DiscountAdminNotFoundError({
              resource: {
                kind: "Dotypos discount group",
                id: input.discountGroupId,
              },
              message:
                "The Dotypos discount group does not exist or is unavailable.",
            });
          }
          if (
            toDotyposDiscountBasisPoints(group.discountPercent) === undefined
          ) {
            return yield* new ValidationError({
              message:
                "The Dotypos discount group has an invalid discount percentage.",
            });
          }
        }
        yield* dotypos.setCustomerDiscountGroup(
          input.customerId,
          input.discountGroupId
        );
      });

      return {
        addCodeCustomer,
        addVoucherCustomer,
        createCode: withDiscountAdminConflict(createCode),
        createCustomerCode: withDiscountAdminConflict(createCustomerCode),
        createCustomerVoucher: withDiscountAdminConflict(createCustomerVoucher),
        createDiscount,
        createVoucher: withDiscountAdminConflict(createVoucher),
        deleteCode: withDiscountAdminConflict(deleteCode),
        deleteDiscount: withDiscountAdminConflict(deleteDiscount),
        deleteVoucher: withDiscountAdminConflict(deleteVoucher),
        loadCodeDetail,
        loadCodesPage,
        loadCustomerCodeCreation,
        loadCustomerBreadcrumbLabel,
        loadCustomerProfile,
        loadDashboard,
        loadSalesPage,
        loadVoucherDetail,
        loadVouchersPage,
        makeCodeUnrestricted,
        makeVoucherUnrestricted,
        removeCodeCustomer,
        removeVoucherCustomer,
        searchCustomers,
        setCustomerDiscountGroup,
        updateCode: withDiscountAdminConflict(updateCode),
        updateDiscount,
        updateVoucher: withDiscountAdminConflict(updateVoucher),
      } satisfies IDiscountAdministration;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        WorkspaceDatabase.Default,
        WorkspaceDotyposLayer,
        WorkspaceGoogleCalendarLayer,
        CalendarResourceConfig.Default
      )
    )
  );
}

type DiscountAdminMissingResource =
  | { readonly kind: "discount"; readonly id: StoredDiscountId }
  | { readonly kind: "discount code"; readonly id: DiscountCodeId }
  | { readonly kind: "voucher"; readonly id: VoucherId }
  | {
      readonly kind: "Dotypos customer";
      readonly id: DotyposCustomerId;
    }
  | {
      readonly kind: "Dotypos discount group";
      readonly id: DotyposDiscountGroupId;
    }
  | {
      readonly kind: "code audience membership";
      readonly id: DotyposCustomerId;
    }
  | {
      readonly kind: "voucher audience membership";
      readonly id: DotyposCustomerId;
    };

export class DiscountAdminNotFoundError extends Data.TaggedError(
  "DiscountAdminNotFoundError"
)<{
  readonly resource: DiscountAdminMissingResource;
  readonly message: string;
}> {}

export class DiscountAdminAudienceError extends Data.TaggedError(
  "DiscountAdminAudienceError"
)<{
  readonly message: string;
}> {}

export class DiscountAdminConflictError extends Data.TaggedError(
  "DiscountAdminConflictError"
)<{
  readonly message: string;
}> {}

const discountAdminConstraintMessages = new Map([
  [
    "promotion_codes_code_unique_idx",
    "A promotion code with this value already exists.",
  ],
  [
    "discount_codes_discount_id_discounts_id_fk",
    "This discount is still referenced by a discount code and cannot be deleted.",
  ],
  [
    "discount_code_redemptions_code_id_discount_codes_id_fk",
    "This discount code has claims and cannot be deleted.",
  ],
  [
    "discount_code_redemptions_code_kind_fk",
    "This discount code has claims and cannot be deleted.",
  ],
  [
    "voucher_redemptions_voucher_id_vouchers_id_fkey",
    "This voucher has claims and cannot be deleted.",
  ],
]);

const withDiscountAdminConflict =
  <Input, A, E, R>(operation: (input: Input) => Effect.Effect<A, E, R>) =>
  (input: Input): Effect.Effect<A, E | DiscountAdminConflictError, R> =>
    operation(input).pipe(
      Effect.mapError((cause) => {
        return findDiscountAdminConflict(cause) ?? cause;
      })
    );

export const findDiscountAdminConflict = (
  cause: unknown
): DiscountAdminConflictError | undefined => {
  const constraint = findConstraintName(cause);
  const message = constraint
    ? discountAdminConstraintMessages.get(constraint)
    : undefined;
  return message ? new DiscountAdminConflictError({ message }) : undefined;
};

const findConstraintName = (
  cause: unknown,
  visited: Set<unknown> = new Set()
): string | undefined => {
  if (!cause || visited.has(cause) || !Predicate.isObjectKeyword(cause)) {
    return undefined;
  }
  visited.add(cause);
  if (
    "constraint" in cause &&
    Predicate.isString(cause.constraint) &&
    cause.constraint.length > 0
  ) {
    return cause.constraint;
  }
  if ("reason" in cause) {
    const constraint = findConstraintName(cause.reason, visited);
    if (constraint) return constraint;
  }
  return "cause" in cause
    ? findConstraintName(cause.cause, visited)
    : undefined;
};

type AdminDiscountRow = StoredDiscount & {
  readonly productTargets: readonly DiscountProductTarget[];
  readonly codes: readonly DiscountCode[];
};

type AdminDiscountCodeRow = DiscountCode & {
  readonly promotion: PromotionCode & {
    readonly customers: readonly {
      readonly dotyposCustomerId: DotyposCustomerId;
    }[];
  };
  readonly redemptions: readonly (DiscountCodeRedemption & {
    readonly application: {
      readonly appliedAmountValue: number;
      readonly appliedAmountExponent: number;
      readonly appliedAmountCurrency: string;
    };
  })[];
};

const toAdminDiscountCode = (row: AdminDiscountCodeRow): AdminDiscountCode => {
  const usage = getAdminDiscountCodeUsage({
    maxUses: row.maxUses,
    states: row.redemptions.map(({ state }) => state),
  });
  return {
    id: row.id,
    discountId: row.discountId,
    code: String(row.promotion.code),
    enabled: row.promotion.enabled,
    validFrom: row.promotion.validFrom,
    validUntil: row.promotion.validUntil,
    maxUses: row.maxUses,
    maxUsesPerCustomer: row.maxUsesPerCustomer,
    audienceSize: row.promotion.customers.length,
    ...usage,
    createdAt: row.promotion.createdAt,
    updatedAt: row.promotion.updatedAt,
  };
};

type AdminVoucherRow = Voucher & {
  readonly promotion: PromotionCode & {
    readonly customers: readonly {
      readonly dotyposCustomerId: DotyposCustomerId;
    }[];
  };
  readonly redemptions: readonly (VoucherRedemption & {
    readonly application: {
      readonly appliedAmountValue: number;
      readonly appliedAmountExponent: number;
      readonly appliedAmountCurrency: string;
    };
  })[];
};

const toAdminVoucher = (row: AdminVoucherRow): AdminVoucher => {
  const issuedCredit = {
    value: row.issuedAmountValue,
    exponent: row.issuedAmountExponent,
    currency: row.issuedAmountCurrency,
  };
  const usedValue = row.redemptions
    .filter(({ state }) => state === "reserved" || state === "redeemed")
    .reduce((total, claim) => total + claim.application.appliedAmountValue, 0);
  const usage = getAdminDiscountCodeUsage({
    maxUses: null,
    states: row.redemptions.map(({ state }) => state),
  });
  return {
    id: row.id,
    code: String(row.promotion.code),
    enabled: row.promotion.enabled,
    validFrom: row.promotion.validFrom,
    validUntil: row.promotion.validUntil,
    issuedCredit,
    remainingCredit: {
      ...issuedCredit,
      value: Math.max(0, issuedCredit.value - usedValue),
    },
    audienceSize: row.promotion.customers.length,
    reservedUses: usage.reservedUses,
    redeemedUses: usage.redeemedUses,
    releasedUses: usage.releasedUses,
    createdAt: row.promotion.createdAt,
    updatedAt: row.promotion.updatedAt,
  };
};

export const getAdminDiscountCodeUsage = (input: {
  readonly maxUses: number | null;
  readonly states: readonly DiscountCodeClaimState[];
}) => {
  const reservedUses = input.states.filter(
    (state) => state === "reserved"
  ).length;
  const redeemedUses = input.states.filter(
    (state) => state === "redeemed"
  ).length;
  const releasedUses = input.states.filter(
    (state) => state === "released"
  ).length;

  return {
    reservedUses,
    redeemedUses,
    releasedUses,
    remainingUses:
      input.maxUses === null
        ? null
        : Math.max(0, input.maxUses - reservedUses - redeemedUses),
  };
};

export const voucherDenominationCanChange = (input: {
  readonly claimCount: number;
  readonly current: Pick<WorkspaceMoney, "currency" | "exponent">;
  readonly updated: Pick<WorkspaceMoney, "currency" | "exponent">;
}) =>
  input.claimCount === 0 ||
  (input.current.currency === input.updated.currency &&
    input.current.exponent === input.updated.exponent);

const toAdminDotyposCustomer = (
  customer: DotyposCustomer
): AdminDotyposCustomer => {
  const personName = [customer.firstName, customer.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();

  return {
    id: Schema.decodeUnknownSync(DotyposCustomerIdSchema)(customer.id),
    displayName:
      customer.companyName?.trim() ||
      personName ||
      customer.email?.trim() ||
      customer.phone?.trim() ||
      "Unnamed customer",
    email: customer.email?.trim() || null,
    phone: customer.phone?.trim() || null,
    discountGroupId: Option.getOrNull(
      Schema.decodeUnknownOption(DotyposDiscountGroupIdSchema)(
        customer._discountGroupId?.trim()
      )
    ),
  };
};

const toAdminDiscountGroup = (
  group: DotyposDiscountGroup
): readonly AdminDiscountGroup[] => {
  const id = Option.getOrUndefined(
    Schema.decodeUnknownOption(DotyposDiscountGroupIdSchema)(group.id?.trim())
  );
  const basisPoints = toDotyposDiscountBasisPoints(group.discountPercent);
  if (
    !id ||
    group.deleted ||
    group.display === false ||
    basisPoints === undefined
  ) {
    return [];
  }

  return [
    {
      id,
      name: group.name?.trim() || id,
      basisPoints,
    },
  ];
};

const toAdminDiscountCodeClaim = (
  row: DiscountCodeRedemption & {
    readonly application: {
      readonly workspaceReservationId: WorkspaceReservationId;
      readonly appliedAmountValue: number;
      readonly appliedAmountExponent: number;
      readonly appliedAmountCurrency: string;
    };
  }
): AdminDiscountCodeClaim => ({
  id: row.id,
  codeId: row.codeId,
  dotyposCustomerId: row.dotyposCustomerId,
  state: row.state,
  paymentAttemptId: row.paymentAttemptId,
  workspaceReservationId: row.application.workspaceReservationId,
  appliedAmount: {
    value: row.application.appliedAmountValue,
    exponent: row.application.appliedAmountExponent,
    currency: row.application.appliedAmountCurrency,
  },
  reservationExpiresAt: row.reservationExpiresAt,
  reservedAt: row.reservedAt,
  redeemedAt: row.redeemedAt,
  releasedAt: row.releasedAt,
  releaseReason: row.releaseReason,
});

const toAdminVoucherClaim = (
  row: VoucherRedemption & {
    readonly application: {
      readonly workspaceReservationId: WorkspaceReservationId;
      readonly appliedAmountValue: number;
      readonly appliedAmountExponent: number;
      readonly appliedAmountCurrency: string;
    };
  }
): AdminVoucherClaim => ({
  id: row.id,
  voucherId: row.voucherId,
  dotyposCustomerId: row.dotyposCustomerId,
  state: row.state,
  paymentAttemptId: row.paymentAttemptId,
  workspaceReservationId: row.application.workspaceReservationId,
  appliedAmount: {
    value: row.application.appliedAmountValue,
    exponent: row.application.appliedAmountExponent,
    currency: row.application.appliedAmountCurrency,
  },
  reservationExpiresAt: row.reservationExpiresAt,
  reservedAt: row.reservedAt,
  redeemedAt: row.redeemedAt,
  releasedAt: row.releasedAt,
  releaseReason: row.releaseReason,
});

const toDiscountAdjustment = (
  row: Pick<
    StoredDiscount,
    | "fixedAmountCurrency"
    | "fixedAmountExponent"
    | "fixedAmountValue"
    | "percentageBasisPoints"
  >
): DiscountAdjustment =>
  row.percentageBasisPoints === null
    ? {
        kind: "fixed",
        amount: {
          value: row.fixedAmountValue!,
          exponent: row.fixedAmountExponent!,
          currency: row.fixedAmountCurrency!,
        },
      }
    : {
        kind: "percentage",
        basisPoints: row.percentageBasisPoints,
      };

const toAdminDiscount = (row: AdminDiscountRow): AdminDiscount => ({
  id: row.id,
  labels: row.labels,
  adjustment: toDiscountAdjustment(row),
  products: row.productTargets.map(({ productTarget }) => productTarget),
  codeCount: row.codes.length,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const toDiscountValues = (
  input: CreateDiscountAdminInput | UpdateDiscountAdminInput
) => ({
  labels: input.labels,
  percentageBasisPoints:
    input.adjustment.kind === "percentage"
      ? input.adjustment.basisPoints
      : null,
  fixedAmountValue:
    input.adjustment.kind === "fixed" ? input.adjustment.amount.value : null,
  fixedAmountExponent:
    input.adjustment.kind === "fixed" ? input.adjustment.amount.exponent : null,
  fixedAmountCurrency:
    input.adjustment.kind === "fixed" ? input.adjustment.amount.currency : null,
});

const toDiscountProductTargetRows = (
  discountId: StoredDiscountId,
  productTargets: readonly WorkspaceProductTarget[]
) => productTargets.map((productTarget) => ({ discountId, productTarget }));

const toPromotionCodeValues = (
  input:
    | CreateManagedDiscountCodeAdminInput["code"]
    | UpdateDiscountCodeAdminInput
    | CreateVoucherAdminInput
    | CreateCustomerVoucherAdminInput
    | UpdateVoucherAdminInput
) => ({
  code: sensitiveDatabaseParameter(input.code),
  enabled: input.enabled,
  validFrom:
    input.validFrom === null ? null : Temporal.Instant.from(input.validFrom),
  validUntil:
    input.validUntil === null ? null : Temporal.Instant.from(input.validUntil),
});

type TransactionClient = Parameters<
  Parameters<WorkspaceDatabaseClient["transaction"]>[0]
>[0];

type PersistedDiscountResource = Extract<
  DiscountAdminMissingResource,
  { readonly kind: "discount" | "discount code" | "voucher" }
>;

const requireUpdatedRow = <
  const Resource extends PersistedDiscountResource,
  const Row extends { readonly id: Resource["id"] },
>(
  rows: readonly Row[],
  resource: Resource
) =>
  rows[0]
    ? Effect.succeed(rows[0])
    : Effect.fail(
        new DiscountAdminNotFoundError({
          resource,
          message: `The ${resource.kind} no longer exists.`,
        })
      );

const loadCalendarDashboard = (input: {
  readonly calendar: GoogleCalendarService["Service"];
  readonly discounts: readonly AdminDiscount[];
  readonly salesCalendarId: SalesCalendarId;
}) => {
  const today = Temporal.Now.plainDateISO(
    workspaceSiteConstants.location.timeZone
  );
  const from = today.subtract({ days: 30 }).toString();
  const to = today.add({ years: 1 }).toString();
  const calendarUrl = `https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(input.salesCalendarId)}`;

  return input.calendar
    .listEvents({
      calendarId: input.salesCalendarId,
      from,
      to,
    })
    .pipe(
      Effect.map((events) => ({
        events: events
          .map((event) =>
            toAdminCalendarSale({
              calendarUrl,
              discounts: input.discounts,
              event,
            })
          )
          .toSorted((left, right) => left.start.localeCompare(right.start)),
        unavailable: false,
        calendarUrl,
        from,
        to,
      })),
      Effect.tapError((cause) =>
        Effect.logError("Discount administration Calendar load failed", {
          cause,
        })
      ),
      Effect.orElseSucceed(() => ({
        events: [],
        unavailable: true,
        calendarUrl,
        from,
        to,
      }))
    );
};

const toAdminCalendarSale = (input: {
  readonly calendarUrl: string;
  readonly discounts: readonly AdminDiscount[];
  readonly event: {
    readonly id?: GoogleCalendarEventId;
    readonly iCalUID?: GoogleCalendarICalUid;
    readonly htmlLink?: string;
    readonly summary?: string;
    readonly description?: string;
    readonly status?: string;
    readonly start?: { readonly date?: string; readonly dateTime?: string };
    readonly end?: { readonly date?: string; readonly dateTime?: string };
  };
}): AdminCalendarSale => {
  const description = input.event.description?.trim() ?? "";
  const normalizedId = description.toLowerCase();
  const discountId = Option.getOrUndefined(
    Schema.decodeUnknownOption(storedDiscountIdSchema)(normalizedId)
  );
  const matchedDiscount = input.discounts.find(({ id }) => id === discountId);
  let association: AdminCalendarSale["association"] = {
    kind: "missing-description",
  };
  if (description.length > 0 && !discountId) {
    association = { kind: "invalid-description" };
  } else if (discountId && matchedDiscount) {
    association = {
      kind: "associated",
      discountId: matchedDiscount.id,
      discountLabel: matchedDiscount.labels["en-US"],
    };
  } else if (discountId) {
    association = { kind: "missing-discount", discountId };
  }

  return {
    eventReference: input.event.id ?? input.event.iCalUID ?? undefined,
    title: input.event.summary?.trim() || "Untitled event",
    description,
    start:
      input.event.start?.date ?? input.event.start?.dateTime ?? "Unknown start",
    end: input.event.end?.date ?? input.event.end?.dateTime ?? "Unknown end",
    status: input.event.status ?? "unknown",
    eventUrl: input.event.htmlLink ?? input.calendarUrl,
    association,
  };
};
