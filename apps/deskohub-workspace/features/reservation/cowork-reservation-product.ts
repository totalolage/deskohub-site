import { Match, Schema, SchemaGetter } from "effect";
import {
  getWorkspaceProductByTier,
  type WorkspaceCoworkProductTier,
  type WorkspaceProductMonitorOption,
  workspaceCoworkProductTiers,
  workspaceProductMonitorOptions,
} from "@/features/checkout/product-catalog";
import { m } from "@/features/i18n";
import {
  coworkReservationKind,
  type WorkspaceReservationKind,
} from "@/features/reservation/reservation-kind";

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

export const workspaceCoworkProductIdentitySchema = Schema.Struct({
  kind: Schema.Literal(coworkReservationKind),
  tier: coworkReservationProductInputSchema.fields.entryTier,
});

export type WorkspaceCoworkProductIdentity =
  typeof workspaceCoworkProductIdentitySchema.Type;

export const workspaceCoworkProductKeySchema = Schema.TemplateLiteral([
  workspaceCoworkProductIdentitySchema.fields.kind,
  ":",
  workspaceCoworkProductIdentitySchema.fields.tier,
]);

export type WorkspaceCoworkProductKey =
  typeof workspaceCoworkProductKeySchema.Type;

export const getWorkspaceCoworkProductKey = ({
  kind,
  tier,
}: WorkspaceCoworkProductIdentity): WorkspaceCoworkProductKey =>
  `${kind}:${tier}`;

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

const storedBasicCoworkReservationDetailsSchema = Schema.Struct({
  kind: workspaceCoworkProductIdentitySchema.fields.kind,
  ...normalizedBasicCoworkReservationProductSchema.fields,
});

const storedPlusCoworkReservationDetailsSchema = Schema.Struct({
  kind: workspaceCoworkProductIdentitySchema.fields.kind,
  ...normalizedPlusCoworkReservationProductSchema.fields,
});

const storedProfiCoworkReservationDetailsSchema = Schema.Struct({
  kind: workspaceCoworkProductIdentitySchema.fields.kind,
  ...normalizedProfiCoworkReservationProductSchema.fields,
});

export const storedCoworkReservationDetailsSchema = Schema.Union([
  storedBasicCoworkReservationDetailsSchema,
  storedPlusCoworkReservationDetailsSchema,
  storedProfiCoworkReservationDetailsSchema,
]).annotate({
  identifier: "StoredCoworkReservationDetails",
  description: "App-owned cowork product intent persisted with a reservation.",
});

export type CoworkReservationProductInput =
  typeof coworkReservationProductInputSchema.Type;
export type NormalizedCoworkReservationProduct =
  typeof normalizedCoworkReservationProductSchema.Type;
export type StoredCoworkReservationDetails =
  typeof storedCoworkReservationDetailsSchema.Type;

type CoworkProductFields = {
  readonly productTier: WorkspaceCoworkProductTier | null;
  readonly productCoffee: boolean;
  readonly productMonitorOption: WorkspaceProductMonitorOption | null;
};

type ReservationWithCoworkProductDetails = {
  readonly reservationDetails:
    | StoredCoworkReservationDetails
    | {
        readonly kind: Exclude<
          WorkspaceReservationKind,
          typeof coworkReservationKind
        >;
      };
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
  Match.value(data.entryTier).pipe(
    Match.when("basic", () =>
      normalizedBasicCoworkReservationProductSchema.make({
        entryTier: "basic",
        coffee: data.coffee,
      })
    ),
    Match.when("plus", () =>
      normalizedPlusCoworkReservationProductSchema.make({
        entryTier: "plus",
        coffee: true,
      })
    ),
    Match.when("profi", () =>
      normalizedProfiCoworkReservationProductSchema.make({
        entryTier: "profi",
        coffee: true,
        monitorOption: normalizeMonitorOption(data.monitorOption)!,
      })
    ),
    Match.exhaustive
  );

export const getStoredCoworkReservationDetails = (
  product: NormalizedCoworkReservationProduct
): StoredCoworkReservationDetails =>
  Match.value(product).pipe(
    Match.discriminatorsExhaustive("entryTier")({
      basic: (basicProduct) =>
        storedBasicCoworkReservationDetailsSchema.make({
          kind: coworkReservationKind,
          entryTier: basicProduct.entryTier,
          coffee: basicProduct.coffee,
        }),
      plus: (plusProduct) =>
        storedPlusCoworkReservationDetailsSchema.make({
          kind: coworkReservationKind,
          entryTier: plusProduct.entryTier,
          coffee: plusProduct.coffee,
        }),
      profi: (profiProduct) =>
        storedProfiCoworkReservationDetailsSchema.make({
          kind: coworkReservationKind,
          entryTier: profiProduct.entryTier,
          coffee: profiProduct.coffee,
          monitorOption: profiProduct.monitorOption,
        }),
    })
  );

const getCoworkReservationProductFields = (
  details: StoredCoworkReservationDetails
): CoworkProductFields =>
  Match.value(details).pipe(
    Match.discriminatorsExhaustive("entryTier")({
      basic: (basicDetails) => ({
        productTier: basicDetails.entryTier,
        productCoffee: basicDetails.coffee,
        productMonitorOption: null,
      }),
      plus: (plusDetails) => ({
        productTier: plusDetails.entryTier,
        productCoffee: plusDetails.coffee,
        productMonitorOption: null,
      }),
      profi: (profiDetails) => ({
        productTier: profiDetails.entryTier,
        productCoffee: profiDetails.coffee,
        productMonitorOption: profiDetails.monitorOption,
      }),
    })
  );

export const withCoworkProductFields = <
  const Reservation extends ReservationWithCoworkProductDetails,
>(
  reservation: Reservation
): Reservation & CoworkProductFields => ({
  ...reservation,
  ...Match.value(reservation.reservationDetails).pipe(
    Match.when(
      { kind: coworkReservationKind },
      getCoworkReservationProductFields
    ),
    Match.orElse(() => ({
      productTier: null,
      productCoffee: false,
      productMonitorOption: null,
    }))
  ),
});

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
