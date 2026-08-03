import {
  DotyposService,
  type ExternalAPIError,
  type NetworkError,
  ValidationError,
} from "@deskohub/dotypos";
import type {
  Customer as DotyposCustomer,
  DiscountGroup as DotyposDiscountGroup,
} from "@deskohub/dotypos/generated";
import { GoogleCalendarService } from "@deskohub/google-calendar";
import { and, eq } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Data, Effect, Layer, Schema } from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  type DiscountCode,
  type DiscountCodeClaimState,
  type DiscountCodeRedemption,
  type DiscountLabels,
  type DiscountProductTarget,
  discountCodeCustomers,
  discountCodes,
  discountProductTargets,
  discounts,
  type StoredDiscount,
} from "@/db/schema";
import type { WorkspaceProductIdentity } from "@/features/checkout/product-identity";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";
import { CalendarResourceConfig } from "@/shared/backend/config/calendar-resource.config";
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
  CreateDiscountAdminInput,
  CreateDiscountCodeAdminInput,
  DiscountAdminCustomerSearch,
  UpdateDiscountAdminInput,
  UpdateDiscountCodeAdminInput,
} from "./contracts";

export type AdminDiscount = {
  readonly id: StoredDiscountId;
  readonly labels: DiscountLabels;
  readonly adjustment: DiscountAdjustment;
  readonly products: readonly WorkspaceProductIdentity[];
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
  readonly discountGroupId: string | null;
};

export type AdminDiscountGroup = {
  readonly id: string;
  readonly name: string;
  readonly basisPoints: number;
};

export type AdminDiscountCodeClaim = {
  readonly id: DiscountCodeClaimId;
  readonly codeId: DiscountCodeId;
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly state: DiscountCodeClaimState;
  readonly paymentAttemptId: string;
  readonly workspaceReservationId: string;
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

export type AdminCustomerSearchResult = {
  readonly kind: "matched" | "not-found" | "ambiguous";
  readonly customers: readonly AdminDotyposCustomer[];
};

export type AdminCalendarSale = {
  readonly eventReference: string;
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

export interface IDiscountAdministration {
  readonly loadDashboard: () => Effect.Effect<
    DiscountAdminDashboard,
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
    EffectDrizzleQueryError | SqlError | DiscountAdminNotFoundError
  >;
  readonly createCode: (
    input: CreateDiscountCodeAdminInput
  ) => Effect.Effect<DiscountCodeId, EffectDrizzleQueryError | SqlError>;
  readonly updateCode: (
    input: UpdateDiscountCodeAdminInput
  ) => Effect.Effect<
    void,
    EffectDrizzleQueryError | SqlError | DiscountAdminNotFoundError
  >;
  readonly deleteCode: (
    input: DeleteCodeInput
  ) => Effect.Effect<
    void,
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
    readonly discountGroupId: string | null;
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
                    resource: "Dotypos customer",
                    id: customerId,
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
                resource: "Dotypos customer",
                id: customerId,
                message: "The Dotypos customer does not exist or is deleted.",
              })
          )
        )
      );

      const loadDashboard = Effect.fn("DiscountAdministration.loadDashboard")(
        () =>
          Effect.Do.pipe(
            Effect.bind("definitionRows", () =>
              db.query.discounts.findMany({
                with: {
                  codes: {},
                  productTargets: {},
                },
              })
            ),
            Effect.bind("codeRows", () =>
              db.query.discountCodes.findMany({
                with: {
                  customers: {},
                  redemptions: {},
                },
              })
            ),
            Effect.let("discounts", ({ definitionRows }) =>
              definitionRows
                .map(toAdminDiscount)
                .toSorted((left, right) =>
                  (left.labels["en-US"] ?? "").localeCompare(
                    right.labels["en-US"] ?? ""
                  )
                )
            ),
            Effect.let("codes", ({ codeRows }) =>
              codeRows
                .map(toAdminDiscountCode)
                .toSorted((left, right) => left.code.localeCompare(right.code))
            ),
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
              yield* tx.insert(discountProductTargets).values(
                input.products.map((productIdentity) => ({
                  discountId: row.id,
                  productIdentity,
                }))
              );
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
              yield* requireUpdatedRow(rows, "discount", input.id);
              yield* tx
                .delete(discountProductTargets)
                .where(eq(discountProductTargets.discountId, input.id));
              yield* tx.insert(discountProductTargets).values(
                input.products.map((productIdentity) => ({
                  discountId: input.id,
                  productIdentity,
                }))
              );
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
                requireUpdatedRow(rows, "discount", input.id)
              )
            )
      );

      const createCode = Effect.fn("DiscountAdministration.createCode")(
        (input: CreateDiscountCodeAdminInput) =>
          db
            .insert(discountCodes)
            .values(toDiscountCodeValues(input))
            .returning({ id: discountCodes.id })
            .pipe(
              Effect.flatMap((rows) => {
                const row = rows[0];
                return row
                  ? Effect.succeed(row.id)
                  : Effect.die(
                      new Error("Discount code insert returned no identifier.")
                    );
              })
            )
      );

      const updateCode = Effect.fn("DiscountAdministration.updateCode")(
        (input: UpdateDiscountCodeAdminInput) =>
          db
            .update(discountCodes)
            .set({
              ...toDiscountCodeValues(input),
              updatedAt: Temporal.Now.instant(),
            })
            .where(eq(discountCodes.id, input.id))
            .returning({ id: discountCodes.id })
            .pipe(
              Effect.flatMap((rows) =>
                requireUpdatedRow(rows, "discount code", input.id)
              )
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
                requireUpdatedRow(rows, "discount code", input.id)
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
                        resource: "discount code",
                        id: input.codeId,
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
                        customerId: dotyposCustomerId as DotyposCustomerId,
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

      const searchCustomers = Effect.fn(
        "DiscountAdministration.searchCustomers"
      )(function* (input: DiscountAdminCustomerSearch) {
        if (input.kind === "id") {
          const customer = yield* dotypos
            .getCustomer(input.customerId)
            .pipe(
              Effect.catchTag("ExternalAPIError", (error) =>
                error.statusCode === 404
                  ? Effect.succeed(undefined)
                  : Effect.fail(error)
              )
            );
          return !customer || customer.deleted || !customer.id
            ? ({
                kind: "not-found",
                customers: [],
              } satisfies AdminCustomerSearchResult)
            : ({
                kind: "matched",
                customers: [toAdminDotyposCustomer(customer)],
              } satisfies AdminCustomerSearchResult);
        }

        const lookupField = input.kind;
        const result = yield* dotypos.findCustomer(
          {
            firstName: "",
            ...(input.kind === "email"
              ? { email: input.email }
              : { phone: input.phone }),
          },
          { lookupFields: [lookupField] }
        );
        let kind: AdminCustomerSearchResult["kind"] = "not-found";
        if (result._tag === "Matched") kind = "matched";
        else if (result._tag === "Ambiguous") kind = "ambiguous";
        return {
          kind,
          customers: result.matches
            .filter((customer) => customer.id && !customer.deleted)
            .map(toAdminDotyposCustomer),
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
                discountLabel: row.discount.labels["en-US"],
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
            yield* requireUpdatedRow(codeRows, "discount code", input.codeId);
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
              yield* requireUpdatedRow(codeRows, "discount code", input.codeId);
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
                  resource: "code audience membership",
                  id: input.customerId,
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
            yield* requireUpdatedRow(codeRows, "discount code", input.codeId);
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
        readonly discountGroupId: string | null;
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
              resource: "Dotypos discount group",
              id: input.discountGroupId,
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
        createCode,
        createDiscount,
        deleteCode,
        deleteDiscount,
        loadCodeDetail,
        loadCustomerProfile,
        loadDashboard,
        makeCodeUnrestricted,
        removeCodeCustomer,
        searchCustomers,
        setCustomerDiscountGroup,
        updateCode,
        updateDiscount,
      } satisfies IDiscountAdministration;
    })
  );
}

export class DiscountAdminNotFoundError extends Data.TaggedError(
  "DiscountAdminNotFoundError"
)<{
  readonly resource:
    | "discount"
    | "discount code"
    | "Dotypos customer"
    | "Dotypos discount group"
    | "code audience membership";
  readonly id: string;
  readonly message: string;
}> {}

export class DiscountAdminAudienceError extends Data.TaggedError(
  "DiscountAdminAudienceError"
)<{
  readonly message: string;
}> {}

type AdminDiscountRow = StoredDiscount & {
  readonly productTargets: readonly DiscountProductTarget[];
  readonly codes: readonly DiscountCode[];
};

type AdminDiscountCodeRow = DiscountCode & {
  readonly customers: readonly {
    readonly dotyposCustomerId: string;
  }[];
  readonly redemptions: readonly DiscountCodeRedemption[];
};

const toAdminDiscountCode = (row: AdminDiscountCodeRow): AdminDiscountCode => {
  const usage = getAdminDiscountCodeUsage({
    maxUses: row.maxUses,
    states: row.redemptions.map(({ state }) => state),
  });

  return {
    id: row.id,
    discountId: row.discountId,
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
    id: customer.id as DotyposCustomerId,
    displayName:
      customer.companyName?.trim() ||
      personName ||
      customer.email?.trim() ||
      customer.phone?.trim() ||
      "Unnamed customer",
    email: customer.email?.trim() || null,
    phone: customer.phone?.trim() || null,
    discountGroupId: customer._discountGroupId?.trim() || null,
  };
};

const toAdminDiscountGroup = (
  group: DotyposDiscountGroup
): readonly AdminDiscountGroup[] => {
  const id = group.id?.trim();
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
      readonly workspaceReservationId: string;
    };
  }
): AdminDiscountCodeClaim => ({
  id: row.id,
  codeId: row.codeId,
  dotyposCustomerId: row.dotyposCustomerId as DotyposCustomerId,
  state: row.state,
  paymentAttemptId: row.paymentAttemptId,
  workspaceReservationId: row.application.workspaceReservationId,
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
  products: row.productTargets.map(({ productIdentity }) => productIdentity),
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

const toDiscountCodeValues = (
  input: CreateDiscountCodeAdminInput | UpdateDiscountCodeAdminInput
) => ({
  code: input.code,
  discountId: input.discountId,
  enabled: input.enabled,
  validFrom:
    input.validFrom === null ? null : Temporal.Instant.from(input.validFrom),
  validUntil:
    input.validUntil === null ? null : Temporal.Instant.from(input.validUntil),
  maxUses: input.maxUses,
});

const requireUpdatedRow = (
  rows: readonly { readonly id: string }[],
  resource: "discount" | "discount code",
  id: string
) =>
  rows.length === 1
    ? Effect.void
    : Effect.fail(
        new DiscountAdminNotFoundError({
          resource,
          id,
          message: `The ${resource} no longer exists.`,
        })
      );

const loadCalendarDashboard = (input: {
  readonly calendar: GoogleCalendarService["Service"];
  readonly discounts: readonly AdminDiscount[];
  readonly salesCalendarId: string;
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
    readonly id?: string;
    readonly iCalUID?: string;
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
  const discountId = Schema.is(storedDiscountIdSchema)(normalizedId)
    ? (normalizedId as StoredDiscountId)
    : undefined;
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
    eventReference: input.event.id ?? input.event.iCalUID ?? "unknown",
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
