import { Match, Schema, SchemaGetter } from "effect";
import {
  getWorkspaceProductByTier,
  type WorkspaceCoworkProductTier,
  type WorkspaceProductMonitorOption,
  workspaceCoworkProductTiers,
  workspaceProductMonitorOptions,
} from "@/features/checkout/product-catalog";
import { m } from "@/features/i18n";

const coworkReservationMonitorOptionInputSchema = Schema.optional(
  Schema.Union([
    Schema.Literals(workspaceProductMonitorOptions),
    Schema.Literal(""),
  ])
);

export const coworkReservationProductInputSchema = Schema.Struct({
  entryTier: Schema.Literals(workspaceCoworkProductTiers),
  coffee: Schema.Boolean,
  monitorOption: coworkReservationMonitorOptionInputSchema,
});

export const normalizedBasicCoworkReservationProductSchema = Schema.Struct({
  entryTier: Schema.Literal("basic"),
  coffee: Schema.Boolean,
  monitorOption: Schema.optional(Schema.Never),
});

export const normalizedPlusCoworkReservationProductSchema = Schema.Struct({
  entryTier: Schema.Literal("plus"),
  coffee: Schema.Literal(true),
  monitorOption: Schema.optional(Schema.Never),
});

export const normalizedProfiCoworkReservationProductSchema = Schema.Struct({
  entryTier: Schema.Literal("profi"),
  coffee: Schema.Literal(true),
  monitorOption: Schema.Literals(workspaceProductMonitorOptions),
});

export const normalizedCoworkReservationProductSchema = Schema.Union([
  normalizedBasicCoworkReservationProductSchema,
  normalizedPlusCoworkReservationProductSchema,
  normalizedProfiCoworkReservationProductSchema,
]).annotate({
  identifier: "NormalizedCoworkReservationProduct",
  description:
    "Canonical cowork product selection after tier-specific normalization.",
});

export type CoworkReservationProductInput =
  typeof coworkReservationProductInputSchema.Type;
export type NormalizedCoworkReservationProduct =
  typeof normalizedCoworkReservationProductSchema.Type;

export type WorkspaceReservationProductColumns = {
  readonly productTier: WorkspaceCoworkProductTier;
  readonly productCoffee: boolean;
  readonly productMonitorOption?: WorkspaceProductMonitorOption;
};

const normalizeMonitorOption = (
  monitorOption: WorkspaceProductMonitorOption | "" | undefined
) => monitorOption || undefined;

export const getCoworkReservationProductCoffee = (
  reservation: CoworkReservationProductInput
) => Boolean(reservation.coffee);

export const getCoworkReservationProductMonitorOption = (
  reservation: CoworkReservationProductInput
) => normalizeMonitorOption(reservation.monitorOption);

export const getCoworkTierIncludesCourtesyCoffee = (
  tier: WorkspaceCoworkProductTier
) => getWorkspaceProductByTier(tier).includesCourtesyCoffee;

export const getCoworkTierRequiresMonitorOption = (
  tier: WorkspaceCoworkProductTier
) => getWorkspaceProductByTier(tier).requiresMonitorOption;

export const getAllowedMonitorOptionsForCoworkTier = (
  tier: WorkspaceCoworkProductTier
) => getWorkspaceProductByTier(tier).allowedMonitorOptions;

export const getCoworkReservationProductIssues = (
  data: CoworkReservationProductInput
): readonly Schema.FilterIssue[] => {
  const product = getWorkspaceProductByTier(data.entryTier);
  const monitorOption = normalizeMonitorOption(data.monitorOption);

  if (product.requiresMonitorOption && !monitorOption) {
    return [
      {
        path: ["monitorOption"],
        issue: m.reservationValidationMonitorRequired(),
      },
    ];
  }

  if (
    product.requiresMonitorOption &&
    monitorOption &&
    !product.allowedMonitorOptions.includes(monitorOption)
  ) {
    return [
      {
        path: ["monitorOption"],
        issue: m.reservationValidationMonitorUnavailable(),
      },
    ];
  }

  if (!product.requiresMonitorOption && monitorOption) {
    return [
      {
        path: ["monitorOption"],
        issue: m.reservationValidationMonitorUnavailable(),
      },
    ];
  }

  return [];
};

export const normalizeCoworkReservationProduct = (
  data: CoworkReservationProductInput
): NormalizedCoworkReservationProduct =>
  Match.value(data).pipe(
    Match.when({ entryTier: "basic" }, () =>
      normalizedBasicCoworkReservationProductSchema.make({
        entryTier: "basic",
        coffee: data.coffee,
      })
    ),
    Match.when({ entryTier: "plus" }, () =>
      normalizedPlusCoworkReservationProductSchema.make({
        entryTier: "plus",
        coffee: true,
      })
    ),
    Match.when({ entryTier: "profi" }, () =>
      normalizedProfiCoworkReservationProductSchema.make({
        entryTier: "profi",
        coffee: true,
        monitorOption: normalizeMonitorOption(data.monitorOption)!,
      })
    ),
    Match.exhaustive
  );

export const getWorkspaceReservationProductColumns = (
  product: NormalizedCoworkReservationProduct
): WorkspaceReservationProductColumns =>
  Match.value(product).pipe(
    Match.when({ entryTier: "basic" }, (basicProduct) => ({
      productTier: basicProduct.entryTier,
      productCoffee: basicProduct.coffee,
    })),
    Match.when({ entryTier: "plus" }, (plusProduct) => ({
      productTier: plusProduct.entryTier,
      productCoffee: plusProduct.coffee,
    })),
    Match.when({ entryTier: "profi" }, (profiProduct) => ({
      productTier: profiProduct.entryTier,
      productCoffee: profiProduct.coffee,
      productMonitorOption: profiProduct.monitorOption,
    })),
    Match.exhaustive
  );

const decodeCoworkReservationProductInput = Schema.decodeUnknownSync(
  coworkReservationProductInputSchema
);

export const coworkReservationProductSchema =
  coworkReservationProductInputSchema
    .check(Schema.makeFilter(getCoworkReservationProductIssues))
    .pipe(
      Schema.decodeTo(normalizedCoworkReservationProductSchema, {
        decode: SchemaGetter.transform(normalizeCoworkReservationProduct),
        encode: SchemaGetter.transform(decodeCoworkReservationProductInput),
      })
    )
    .annotate({
      identifier: "CoworkReservationProduct",
      description:
        "Cowork product selection validated and normalized by entry tier.",
    });

export type { WorkspaceCoworkProductTier, WorkspaceProductMonitorOption };
