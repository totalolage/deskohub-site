import {
  type DotyposConditionalWriteFailure,
  type DotyposDiscountGroupId,
  type DotyposReadFailure,
  DotyposService,
} from "@deskohub/dotypos";
import type {
  GoogleCalendarEventId,
  GoogleCalendarICalUid,
} from "@deskohub/google-calendar";
import { and, eq, sql } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Data, Effect, Layer, Match, Option } from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  type DiscountCodeClaimState,
  type DiscountLabels,
  discountApplications,
  discountCodes,
  discountProductTargets,
  discounts,
  promotionCodeCustomers,
  promotionCodes,
  voucherRedemptions,
  vouchers,
} from "@/db/schema";
import {
  type DatabaseQueryError,
  findViolatedConstraint,
  isDatabaseQueryError,
} from "@/db/sql-constraint";
import type { AdministrationCustomerName } from "@/features/administration/customer-name";
import type { PaymentAttemptId } from "@/features/checkout/checkout-identifiers";
import type { DiscountGroupListing } from "@/features/discounts/discount-groups";
import type { WorkspaceProductTarget } from "@/features/discounts/product-target";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { CalendarResourceConfig } from "@/shared/backend/config/calendar-resource.config";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import { WorkspaceGoogleCalendarLayer } from "@/shared/backend/config/google-calendar.config";
import {
  type Money,
  type MoneyUnit,
  sameMoneyUnit,
} from "@/shared/money/money";
import type { DiscountAdjustment } from "../contracts";
import { toDotyposDiscountBasisPoints } from "../dotypos-discount-percentage";
import type {
  DiscountCodeClaimId,
  DiscountCodeId,
  StoredDiscountId,
  VoucherClaimId,
  VoucherId,
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
import {
  type DiscountAdminMissingResource,
  DiscountAdminNotFoundError,
} from "./discount-administration-errors";
import { makeDiscountAdministrationReads } from "./discount-administration-reads";

export { DiscountAdminNotFoundError } from "./discount-administration-errors";

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
  readonly issuedCredit: Money;
  readonly remainingCredit: Money;
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
  /** Never empty: the API and `dhw` show "Unnamed customer" when `hasName` is false. */
  readonly displayName: string;
  /** Whether Dotypos holds a name or contact detail, so the Admin UI can name an unnamed customer in the operator's language. */
  readonly hasName: boolean;
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
  readonly appliedAmount: Money;
  readonly reservationExpiresAt: Temporal.Instant;
  readonly reservedAt: Temporal.Instant;
  readonly redeemedAt: Temporal.Instant | null;
  readonly releasedAt: Temporal.Instant | null;
  readonly releaseReason: string | null;
};

export type AdminDiscountCodeDetail = {
  readonly code: AdminDiscountCode;
  /** The English label the administration API returns. */
  readonly discountLabel: string;
  readonly discountLabels: DiscountLabels;
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

type AdminCustomerCode = AdminDiscountCode & {
  readonly discountAdjustment: DiscountAdjustment;
  /** The English label the administration API returns. */
  readonly discountLabel: string;
  readonly discountLabels: DiscountLabels;
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

type AdminCustomerCodeCreation = {
  readonly customer: AdminDotyposCustomer;
  readonly discounts: readonly Pick<AdminDiscount, "id" | "labels">[];
};

type AdminCustomerVoucherCreation = {
  readonly customer: AdminDotyposCustomer;
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
    | DotyposReadFailure
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
    | DotyposReadFailure
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
  ) => Effect.Effect<AdminCustomerSearchResult, DotyposReadFailure>;
  /** Every Dotypos discount group, for choosing one by name. */
  readonly listDiscountGroups: () => Effect.Effect<
    readonly DiscountGroupListing[],
    DotyposReadFailure
  >;
  readonly loadCustomerProfile: (input: {
    readonly customerId: DotyposCustomerId;
  }) => Effect.Effect<
    AdminCustomerProfile,
    | EffectDrizzleQueryError
    | SqlError
    | DotyposReadFailure
    | DiscountAdminNotFoundError
  >;
  readonly loadCustomerBreadcrumbLabel: (input: {
    readonly customerId: DotyposCustomerId;
  }) => Effect.Effect<
    AdministrationCustomerName,
    DotyposReadFailure | DiscountAdminNotFoundError
  >;
  readonly loadCustomerCodeCreation: (input: {
    readonly customerId: DotyposCustomerId;
  }) => Effect.Effect<
    AdminCustomerCodeCreation,
    | EffectDrizzleQueryError
    | SqlError
    | DotyposReadFailure
    | DiscountAdminNotFoundError
  >;
  readonly loadCustomerVoucherCreation: (input: {
    readonly customerId: DotyposCustomerId;
  }) => Effect.Effect<
    AdminCustomerVoucherCreation,
    DotyposReadFailure | DiscountAdminNotFoundError
  >;
  readonly addCodeCustomer: (input: {
    readonly codeId: DiscountCodeId;
    readonly customerId: DotyposCustomerId;
  }) => Effect.Effect<
    void,
    | EffectDrizzleQueryError
    | SqlError
    | DotyposReadFailure
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
    | DotyposReadFailure
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
    | DotyposConditionalWriteFailure
    | DiscountAdminNotFoundError
    | InvalidDotyposDiscountPercentage
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
      const { db, transaction } = yield* WorkspaceDatabase;
      const dotypos = yield* DotyposService;
      const { loadActiveCustomer, ...reads } =
        yield* makeDiscountAdministrationReads;

      const createDiscount = Effect.fn("DiscountAdministration.createDiscount")(
        (input: CreateDiscountAdminInput) =>
          transaction(
            Effect.gen(function* () {
              const rows = yield* db
                .insert(discounts)
                .values(toDiscountValues(input))
                .returning({ id: discounts.id });
              const row = rows[0];
              if (!row) {
                return yield* Effect.die(
                  new Error("Discount insert returned no identifier.")
                );
              }
              yield* db
                .insert(discountProductTargets)
                .values(toDiscountProductTargetRows(row.id, input.products));
              return row.id;
            })
          )
      );

      const updateDiscount = Effect.fn("DiscountAdministration.updateDiscount")(
        (input: UpdateDiscountAdminInput) =>
          transaction(
            Effect.gen(function* () {
              const rows = yield* db
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
              yield* db
                .delete(discountProductTargets)
                .where(eq(discountProductTargets.discountId, input.id));
              yield* db
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
          transaction(
            Effect.gen(function* () {
              const discountId = yield* Match.value(input.discount).pipe(
                Match.discriminatorsExhaustive("kind")({
                  existing: ({ discountId }) =>
                    db
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
                  new: Effect.fn(function* ({ discount }) {
                    const rows = yield* db
                      .insert(discounts)
                      .values(toDiscountValues(discount))
                      .returning({ id: discounts.id });
                    const row = rows[0];
                    if (!row) {
                      return yield* Effect.die(
                        new Error("Discount insert returned no identifier.")
                      );
                    }
                    yield* db
                      .insert(discountProductTargets)
                      .values(
                        toDiscountProductTargetRows(row.id, discount.products)
                      );
                    return row.id;
                  }),
                })
              );
              const [promotion] = yield* db
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
              const codeRows = yield* db
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

        return yield* transaction(
          Effect.gen(function* () {
            const discountId = yield* Match.value(input.discount).pipe(
              Match.discriminatorsExhaustive("kind")({
                existing: ({ discountId }) =>
                  db
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
                new: Effect.fn(function* ({ discount }) {
                  const rows = yield* db
                    .insert(discounts)
                    .values(toDiscountValues(discount))
                    .returning({ id: discounts.id });
                  const row = rows[0];
                  if (!row) {
                    return yield* Effect.die(
                      new Error("Discount insert returned no identifier.")
                    );
                  }
                  yield* db
                    .insert(discountProductTargets)
                    .values(
                      toDiscountProductTargetRows(row.id, discount.products)
                    );
                  return row.id;
                }),
              })
            );
            const [promotion] = yield* db
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
            const codeRows = yield* db
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
            yield* db.insert(promotionCodeCustomers).values({
              promotionCodeId: promotion.id,
              dotyposCustomerId: input.customerId,
            });
            return codeRow.id;
          })
        );
      });

      const updateCode = Effect.fn("DiscountAdministration.updateCode")(
        (input: UpdateDiscountCodeAdminInput) =>
          transaction(
            Effect.gen(function* () {
              const rows = yield* db
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
              yield* db
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
              yield* db
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
          transaction(
            db
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
                  db
                    .delete(promotionCodes)
                    .where(eq(promotionCodes.id, row.promotionCodeId))
                )
              )
          )
      );

      const insertVoucher = Effect.fn("DiscountAdministration.insertVoucher")(
        function* (input: CreateVoucherAdminInput) {
          const [promotion] = yield* db
            .insert(promotionCodes)
            .values({ kind: "voucher", ...toPromotionCodeValues(input) })
            .returning({ id: promotionCodes.id });
          if (!promotion) {
            return yield* Effect.die(
              new Error("Promotion insert returned no identifier.")
            );
          }
          const [voucher] = yield* db
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
          transaction(
            insertVoucher(input).pipe(Effect.map(({ voucherId }) => voucherId))
          )
      );

      const createCustomerVoucher = Effect.fn(
        "DiscountAdministration.createCustomerVoucher"
      )(function* (input: CreateCustomerVoucherAdminInput) {
        yield* loadActiveCustomer(input.customerId);
        return yield* transaction(
          Effect.gen(function* () {
            const created = yield* insertVoucher(input);
            yield* db.insert(promotionCodeCustomers).values({
              promotionCodeId: created.promotionCodeId,
              dotyposCustomerId: input.customerId,
            });
            return created.voucherId;
          })
        );
      });

      const updateVoucher = Effect.fn("DiscountAdministration.updateVoucher")(
        (input: UpdateVoucherAdminInput) =>
          transaction(
            Effect.gen(function* () {
              const row = yield* db
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
              const [usage] = yield* db
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
                  reason: "voucher-credit-below-usage",
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
                  reason: "voucher-currency-locked",
                  message:
                    "Voucher currency cannot change after it has claim history.",
                });
              }
              const updatedAt = Temporal.Now.instant();
              yield* db
                .update(vouchers)
                .set({
                  issuedAmountValue: input.credit.value,
                  issuedAmountExponent: input.credit.exponent,
                  issuedAmountCurrency: input.credit.currency,
                  updatedAt,
                })
                .where(eq(vouchers.id, input.id));
              yield* db
                .update(promotionCodes)
                .set({ ...toPromotionCodeValues(input), updatedAt })
                .where(eq(promotionCodes.id, row.promotionCodeId));
            })
          )
      );

      const deleteVoucher = Effect.fn("DiscountAdministration.deleteVoucher")(
        (input: { readonly id: VoucherId }) =>
          transaction(
            db
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
                  db
                    .delete(promotionCodes)
                    .where(eq(promotionCodes.id, row.promotionCodeId))
                )
              )
          )
      );

      const addCodeCustomer = Effect.fn(
        "DiscountAdministration.addCodeCustomer"
      )(function* (input: {
        readonly codeId: DiscountCodeId;
        readonly customerId: DotyposCustomerId;
      }) {
        yield* loadActiveCustomer(input.customerId);

        yield* transaction(
          Effect.gen(function* () {
            const codeRows = yield* db
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
            yield* db
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
          transaction(
            Effect.gen(function* () {
              const codeRows = yield* db
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
              const audience = yield* db
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
                  promotionKind: "discount-code",
                  message:
                    "Removing the final customer would make this code unrestricted. Use Make unrestricted instead.",
                });
              }
              yield* db
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
        transaction(
          Effect.gen(function* () {
            const codeRows = yield* db
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
            yield* db
              .delete(promotionCodeCustomers)
              .where(
                eq(promotionCodeCustomers.promotionCodeId, code.promotionCodeId)
              );
          })
        )
      );

      const loadVoucherPromotionId = Effect.fn(
        "DiscountAdministration.loadVoucherPromotionId"
      )((voucherId: VoucherId) =>
        db
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
        yield* transaction(
          loadVoucherPromotionId(input.voucherId).pipe(
            Effect.flatMap((promotionCodeId) =>
              db
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
          transaction(
            Effect.gen(function* () {
              const promotionCodeId = yield* loadVoucherPromotionId(
                input.voucherId
              );
              const audience = yield* db
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
                  promotionKind: "voucher",
                  message:
                    "Removing the final customer would make this voucher unrestricted. Use Make unrestricted instead.",
                });
              }
              yield* db
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
        transaction(
          loadVoucherPromotionId(input.voucherId).pipe(
            Effect.flatMap((promotionCodeId) =>
              db
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
            return yield* new InvalidDotyposDiscountPercentage({
              discountGroupId: input.discountGroupId,
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
        ...reads,
        makeCodeUnrestricted,
        makeVoucherUnrestricted,
        removeCodeCustomer,
        removeVoucherCustomer,
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

/** A Dotypos discount group reports a percentage Workspace can't apply. */
class InvalidDotyposDiscountPercentage extends Data.TaggedError(
  "InvalidDotyposDiscountPercentage"
)<{
  readonly discountGroupId: DotyposDiscountGroupId;
  readonly message: string;
}> {}

export class DiscountAdminAudienceError extends Data.TaggedError(
  "DiscountAdminAudienceError"
)<{
  /** The promotion whose final audience customer the removal targeted. */
  readonly promotionKind: "discount-code" | "voucher";
  readonly message: string;
}> {}

export type DiscountAdminConflictReason =
  | "promotion-code-taken"
  | "discount-referenced"
  | "discount-code-claimed"
  | "voucher-claimed"
  | "voucher-credit-below-usage"
  | "voucher-currency-locked";

export class DiscountAdminConflictError extends Data.TaggedError(
  "DiscountAdminConflictError"
)<{
  readonly reason: DiscountAdminConflictReason;
  readonly message: string;
}> {}

const discountAdminConstraintConflicts = new Map<
  string,
  Pick<DiscountAdminConflictError, "message" | "reason">
>([
  [
    "promotion_codes_code_unique_idx",
    {
      reason: "promotion-code-taken",
      message: "A promotion code with this value already exists.",
    },
  ],
  [
    "discount_codes_discount_id_discounts_id_fk",
    {
      reason: "discount-referenced",
      message:
        "This discount is still referenced by a discount code and cannot be deleted.",
    },
  ],
  [
    "discount_code_redemptions_code_id_discount_codes_id_fk",
    {
      reason: "discount-code-claimed",
      message: "This discount code has claims and cannot be deleted.",
    },
  ],
  [
    "discount_code_redemptions_code_kind_fk",
    {
      reason: "discount-code-claimed",
      message: "This discount code has claims and cannot be deleted.",
    },
  ],
  [
    "voucher_redemptions_voucher_id_vouchers_id_fkey",
    {
      reason: "voucher-claimed",
      message: "This voucher has claims and cannot be deleted.",
    },
  ],
]);

const withDiscountAdminConflict =
  <Input, A, E, R>(operation: (input: Input) => Effect.Effect<A, E, R>) =>
  (input: Input): Effect.Effect<A, E | DiscountAdminConflictError, R> =>
    operation(input).pipe(
      Effect.catchIf(isDatabaseQueryError, (cause) =>
        Effect.fail(findDiscountAdminConflict(cause) ?? cause)
      )
    );

export const findDiscountAdminConflict = (
  cause: DatabaseQueryError
): DiscountAdminConflictError | undefined =>
  findViolatedConstraint(cause).pipe(
    Option.flatMapNullishOr((constraint) =>
      discountAdminConstraintConflicts.get(constraint)
    ),
    Option.map((conflict) => new DiscountAdminConflictError(conflict)),
    Option.getOrUndefined
  );

export const voucherDenominationCanChange = (input: {
  readonly claimCount: number;
  readonly current: MoneyUnit;
  readonly updated: MoneyUnit;
}) => input.claimCount === 0 || sameMoneyUnit(input.current, input.updated);

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
  code: input.code,
  enabled: input.enabled,
  validFrom:
    input.validFrom === null ? null : Temporal.Instant.from(input.validFrom),
  validUntil:
    input.validUntil === null ? null : Temporal.Instant.from(input.validUntil),
});

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
