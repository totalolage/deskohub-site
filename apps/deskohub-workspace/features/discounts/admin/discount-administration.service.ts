import { GoogleCalendarService } from "@deskohub/google-calendar";
import { eq } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Data, Effect, Layer, Schema } from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  type DiscountCode,
  type DiscountLabels,
  type DiscountProductTarget,
  discountCodes,
  discountProductTargets,
  discounts,
  type StoredDiscount,
} from "@/db/schema";
import type { WorkspaceProductIdentity } from "@/features/checkout/product-identity";
import { CalendarResourceConfig } from "@/shared/backend/config/calendar-resource.config";
import { workspaceSiteConstants } from "@/shared/utils";
import type { DiscountAdjustment } from "../contracts";
import {
  type DiscountCodeId,
  type StoredDiscountId,
  storedDiscountIdSchema,
} from "../persistence-contracts";
import type {
  CreateDiscountAdminInput,
  CreateDiscountCodeAdminInput,
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
  readonly createdAt: Temporal.Instant;
  readonly updatedAt: Temporal.Instant;
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
      const { salesCalendarId } = yield* CalendarResourceConfig;

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
            Effect.bind("codeRows", () => db.query.discountCodes.findMany()),
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
                .map((row) => ({ ...row, code: String(row.code) }))
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

      return {
        createCode,
        createDiscount,
        deleteCode,
        deleteDiscount,
        loadDashboard,
        updateCode,
        updateDiscount,
      } satisfies IDiscountAdministration;
    })
  );
}

export class DiscountAdminNotFoundError extends Data.TaggedError(
  "DiscountAdminNotFoundError"
)<{
  readonly resource: "discount" | "discount code";
  readonly id: string;
  readonly message: string;
}> {}

type AdminDiscountRow = StoredDiscount & {
  readonly productTargets: readonly DiscountProductTarget[];
  readonly codes: readonly DiscountCode[];
};

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

  return {
    eventReference: input.event.id ?? input.event.iCalUID ?? "unknown",
    title: input.event.summary?.trim() || "Untitled event",
    description,
    start:
      input.event.start?.date ?? input.event.start?.dateTime ?? "Unknown start",
    end: input.event.end?.date ?? input.event.end?.dateTime ?? "Unknown end",
    status: input.event.status ?? "unknown",
    eventUrl: input.event.htmlLink ?? input.calendarUrl,
    association:
      description.length === 0
        ? { kind: "missing-description" }
        : !discountId
          ? { kind: "invalid-description" }
          : matchedDiscount
            ? {
                kind: "associated",
                discountId: matchedDiscount.id,
                discountLabel: matchedDiscount.labels["en-US"],
              }
            : { kind: "missing-discount", discountId },
  };
};
