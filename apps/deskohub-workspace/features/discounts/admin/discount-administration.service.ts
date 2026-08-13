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
import { and, eq, inArray, sql } from "drizzle-orm";
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
import { WorkspaceDatabase } from "@/db/database.service";
import {
  type DiscountCode,
  type DiscountCodeClaimState,
  type DiscountCodeRedemption,
  type DiscountLabels,
  type DiscountProductTarget,
  discountApplications,
  discountCodeCustomers,
  discountCodeRedemptions,
  discountCodes,
  discountProductTargets,
  discounts,
  type StoredDiscount,
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
import { sensitiveDatabaseParameter } from "@/shared/backend/logging/database-query-parameter-classifier";
import { workspaceSiteConstants } from "@/shared/utils";
import type { DiscountAdjustment } from "../contracts";
import { toDotyposDiscountBasisPoints } from "../dotypos-discount-percentage";
import {
  type DiscountCodeClaimId,
  type DiscountCodeId,
  type StoredDiscountId,
  storedDiscountIdSchema,
} from "../persistence-contracts";
import type {
  CreateCustomerDiscountCodeAdminInput,
  CreateDiscountAdminInput,
  CreateDiscountCodeAdminInput,
  CreateManagedDiscountCodeAdminInput,
  DiscountAdminCustomerSearch,
  UpdateDiscountAdminInput,
  UpdateDiscountCodeAdminInput,
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
  readonly kind: "discount" | "voucher";
  readonly discountId: StoredDiscountId | null;
  readonly voucherCredit: WorkspaceMoney | null;
  readonly remainingVoucherCredit: WorkspaceMoney | null;
  readonly code: string;
  readonly enabled: boolean;
  readonly validFrom: Temporal.Instant | null;
  readonly validUntil: Temporal.Instant | null;
  readonly maxUses: number | null;
  readonly audienceSize: number;
  readonly reservedUses: number;
  readonly redeemedUses: number;
  readonly releasedUses: number;
  readonly remainingUses: number | null;
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

export type AdminCustomerCode = AdminDiscountCode & {
  readonly discountLabel: string;
  readonly eligible: boolean;
};

export type AdminCustomerProfile = {
  readonly customer: AdminDotyposCustomer;
  readonly discountGroups: readonly AdminDiscountGroup[];
  readonly codes: readonly AdminCustomerCode[];
  readonly claims: readonly AdminDiscountCodeClaim[];
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
  static Live = Layer.effect(
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
              customers: {},
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
          loadCodesPage().pipe(
            Effect.bind("calendar", ({ discounts }) =>
              loadCalendarDashboard({
                calendar,
                discounts,
                salesCalendarId,
              })
            ),
            Effect.map(({ calendar, codes, discounts }) => ({
              calendar,
              codes,
              discounts,
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
                  voucher: () => Effect.succeed(null),
                })
              );
              const codeRows = yield* tx
                .insert(discountCodes)
                .values(
                  toDiscountCodeValues(
                    input.discount.kind === "voucher"
                      ? {
                          kind: "voucher",
                          ...input.code,
                          credit: input.discount.credit,
                        }
                      : {
                          kind: "discount",
                          ...input.code,
                          discountId: discountId!,
                        }
                  )
                )
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
                voucher: () => Effect.succeed(null),
              })
            );
            const codeRows = yield* tx
              .insert(discountCodes)
              .values(
                toDiscountCodeValues(
                  input.discount.kind === "voucher"
                    ? {
                        kind: "voucher",
                        ...input.code,
                        credit: input.discount.credit,
                      }
                    : {
                        kind: "discount",
                        ...input.code,
                        discountId: discountId!,
                      }
                )
              )
              .returning({ id: discountCodes.id });
            const codeRow = codeRows[0];
            if (!codeRow) {
              return yield* Effect.die(
                new Error("Discount code insert returned no identifier.")
              );
            }
            yield* tx.insert(discountCodeCustomers).values({
              codeId: codeRow.id,
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
                  kind: discountCodes.kind,
                  voucherAmountExponent: discountCodes.voucherAmountExponent,
                  voucherAmountCurrency: discountCodes.voucherAmountCurrency,
                })
                .from(discountCodes)
                .where(eq(discountCodes.id, input.id))
                .limit(1)
                .for("update");
              yield* requireUpdatedRow(rows, {
                kind: "discount code",
                id: input.id,
              });
              if (rows[0]?.kind !== input.kind) {
                return yield* new DiscountAdminConflictError({
                  message:
                    "A discount code cannot be converted into a voucher or back.",
                });
              }
              if (input.kind === "voucher") {
                const [usage] = yield* tx
                  .select({
                    value: sql<number>`coalesce(sum(${discountApplications.appliedAmountValue}), 0)::integer`,
                  })
                  .from(discountCodeRedemptions)
                  .innerJoin(
                    discountApplications,
                    eq(
                      discountApplications.id,
                      discountCodeRedemptions.applicationId
                    )
                  )
                  .where(
                    and(
                      eq(discountCodeRedemptions.codeId, input.id),
                      inArray(discountCodeRedemptions.state, [
                        "reserved",
                        "redeemed",
                      ])
                    )
                  );
                const usedValue = usage?.value ?? 0;
                if (usedValue > input.credit.value) {
                  return yield* new DiscountAdminConflictError({
                    message:
                      "Voucher credit cannot be lower than its reserved and redeemed value.",
                  });
                }
                if (
                  usedValue > 0 &&
                  (rows[0]?.voucherAmountExponent !== input.credit.exponent ||
                    rows[0]?.voucherAmountCurrency !== input.credit.currency)
                ) {
                  return yield* new DiscountAdminConflictError({
                    message:
                      "Voucher currency cannot change after credit has been spent or reserved.",
                  });
                }
              }
              yield* tx
                .update(discountCodes)
                .set({
                  ...toDiscountCodeValues(input),
                  updatedAt: Temporal.Now.instant(),
                })
                .where(eq(discountCodes.id, input.id));
            })
          )
      );

      const deleteCode = Effect.fn("DiscountAdministration.deleteCode")(
        (input: DeleteCodeInput) =>
          db
            .delete(discountCodes)
            .where(eq(discountCodes.id, input.id))
            .returning({ id: discountCodes.id })
            .pipe(
              Effect.flatMap((rows) =>
                requireUpdatedRow(rows, {
                  kind: "discount code",
                  id: input.id,
                })
              )
            )
      );

      const loadCodeDetail = Effect.fn("DiscountAdministration.loadCodeDetail")(
        (input: { readonly codeId: DiscountCodeId }) =>
          db.query.discountCodes
            .findFirst({
              where: { id: { eq: input.codeId } },
              with: {
                customers: {},
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
                  row.customers,
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
                discountLabel: row.discount?.labels["en-US"] ?? "Voucher",
                customers,
                claims: row.redemptions
                  .map(toAdminDiscountCodeClaim)
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
              customers: {},
              discount: {},
              redemptions: {
                with: {
                  application: {},
                },
              },
            },
          }),
        }).pipe(
          Effect.map(({ codeRows, customer, discountGroups }) => ({
            customer: toAdminDotyposCustomer(customer),
            discountGroups: discountGroups
              .flatMap(toAdminDiscountGroup)
              .toSorted((left, right) => left.name.localeCompare(right.name)),
            codes: codeRows
              .map((row) => ({
                ...toAdminDiscountCode(row),
                discountLabel: row.discount?.labels["en-US"] ?? "Voucher",
                eligible: row.customers.some(
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
              .select({ id: discountCodes.id })
              .from(discountCodes)
              .where(eq(discountCodes.id, input.codeId))
              .for("update");
            yield* requireUpdatedRow(codeRows, {
              kind: "discount code",
              id: input.codeId,
            });
            yield* tx
              .insert(discountCodeCustomers)
              .values({
                codeId: input.codeId,
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
                .select({ id: discountCodes.id })
                .from(discountCodes)
                .where(eq(discountCodes.id, input.codeId))
                .for("update");
              yield* requireUpdatedRow(codeRows, {
                kind: "discount code",
                id: input.codeId,
              });
              const audience = yield* tx
                .select({
                  customerId: discountCodeCustomers.dotyposCustomerId,
                })
                .from(discountCodeCustomers)
                .where(eq(discountCodeCustomers.codeId, input.codeId));
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
                .delete(discountCodeCustomers)
                .where(
                  and(
                    eq(discountCodeCustomers.codeId, input.codeId),
                    eq(
                      discountCodeCustomers.dotyposCustomerId,
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
              .select({ id: discountCodes.id })
              .from(discountCodes)
              .where(eq(discountCodes.id, input.codeId))
              .for("update");
            yield* requireUpdatedRow(codeRows, {
              kind: "discount code",
              id: input.codeId,
            });
            yield* tx
              .delete(discountCodeCustomers)
              .where(eq(discountCodeCustomers.codeId, input.codeId));
          })
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
        createCode: withDiscountAdminConflict(createCode),
        createCustomerCode: withDiscountAdminConflict(createCustomerCode),
        createDiscount,
        deleteCode: withDiscountAdminConflict(deleteCode),
        deleteDiscount: withDiscountAdminConflict(deleteDiscount),
        loadCodeDetail,
        loadCodesPage,
        loadCustomerCodeCreation,
        loadCustomerBreadcrumbLabel,
        loadCustomerProfile,
        loadDashboard,
        loadSalesPage,
        makeCodeUnrestricted,
        removeCodeCustomer,
        searchCustomers,
        setCustomerDiscountGroup,
        updateCode: withDiscountAdminConflict(updateCode),
        updateDiscount,
      } satisfies IDiscountAdministration;
    })
  );
}

type DiscountAdminMissingResource =
  | { readonly kind: "discount"; readonly id: StoredDiscountId }
  | { readonly kind: "discount code"; readonly id: DiscountCodeId }
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
    "discount_codes_code_unique_idx",
    "A discount code with this value already exists.",
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
  readonly customers: readonly {
    readonly dotyposCustomerId: DotyposCustomerId;
  }[];
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
  const voucherCredit =
    row.kind === "voucher"
      ? {
          value: row.voucherAmountValue!,
          exponent: row.voucherAmountExponent!,
          currency: row.voucherAmountCurrency!,
        }
      : null;
  const usedVoucherValue = row.redemptions
    .filter(({ state }) => state === "reserved" || state === "redeemed")
    .reduce((total, claim) => total + claim.application.appliedAmountValue, 0);

  return {
    id: row.id,
    kind: row.kind,
    discountId: row.discountId,
    voucherCredit,
    remainingVoucherCredit: voucherCredit
      ? {
          ...voucherCredit,
          value: Math.max(0, voucherCredit.value - usedVoucherValue),
        }
      : null,
    code: String(row.code),
    enabled: row.enabled,
    validFrom: row.validFrom,
    validUntil: row.validUntil,
    maxUses: row.maxUses,
    audienceSize: row.customers.length,
    ...usage,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
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

const toAdminDiscount = (row: AdminDiscountRow): AdminDiscount => ({
  id: row.id,
  labels: row.labels,
  adjustment:
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
        },
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

const toDiscountCodeValues = (
  input:
    | (CreateDiscountCodeAdminInput & { readonly kind: "discount" })
    | Extract<UpdateDiscountCodeAdminInput, { readonly kind: "discount" }>
    | ({
        readonly kind: "voucher";
        readonly credit: WorkspaceMoney;
      } & CreateCustomerDiscountCodeAdminInput["code"])
    | Extract<UpdateDiscountCodeAdminInput, { readonly kind: "voucher" }>
) => ({
  code: sensitiveDatabaseParameter(input.code),
  kind: input.kind,
  discountId: input.kind === "discount" ? input.discountId : null,
  voucherAmountValue: input.kind === "voucher" ? input.credit.value : null,
  voucherAmountExponent:
    input.kind === "voucher" ? input.credit.exponent : null,
  voucherAmountCurrency:
    input.kind === "voucher" ? input.credit.currency : null,
  enabled: input.enabled,
  validFrom:
    input.validFrom === null ? null : Temporal.Instant.from(input.validFrom),
  validUntil:
    input.validUntil === null ? null : Temporal.Instant.from(input.validUntil),
  maxUses: input.kind === "discount" ? input.maxUses : null,
});

type PersistedDiscountResource = Extract<
  DiscountAdminMissingResource,
  { readonly kind: "discount" | "discount code" }
>;

const requireUpdatedRow = <const Resource extends PersistedDiscountResource>(
  rows: readonly { readonly id: Resource["id"] }[],
  resource: Resource
) =>
  rows.length === 1
    ? Effect.void
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
