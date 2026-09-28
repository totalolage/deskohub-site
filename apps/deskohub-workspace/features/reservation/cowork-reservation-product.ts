import { Match, Schema, SchemaGetter } from "effect";
import {
  getCoworkTierWorkstationAddon,
  getWorkspaceProductByTier,
  type WorkspaceCoworkCurrentTier,
  type WorkspaceCoworkHistoricalTier,
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
  tier: Schema.Literals(workspaceCoworkProductTiers),
});

export type WorkspaceCoworkProductIdentity =
  typeof workspaceCoworkProductIdentitySchema.Type;

export const workspaceCoworkProductTargetSchema = Schema.Struct({
  kind: workspaceCoworkProductIdentitySchema.fields.kind,
});

export type WorkspaceCoworkProductTarget =
  typeof workspaceCoworkProductTargetSchema.Type;

export type WorkspaceCoworkAvailabilityTarget = WorkspaceCoworkProductTarget & {
  readonly entryTier: WorkspaceCoworkProductTier;
  readonly monitorOption?: WorkspaceProductMonitorOption;
};

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

export const normalizedOpenSpaceCoworkReservationProductSchema = Schema.Struct({
  entryTier: Schema.Literal("open-space" satisfies WorkspaceCoworkCurrentTier),
  coffee: Schema.Boolean,
  monitorOption: Schema.optional(Schema.Never),
});

export const normalizedReservedDeskCoworkReservationProductSchema =
  Schema.Struct({
    entryTier: Schema.Literal(
      "reserved-desk" satisfies WorkspaceCoworkCurrentTier
    ),
    coffee: Schema.Literal(true),
    monitorOption: Schema.optional(
      Schema.Literals(workspaceProductMonitorOptions)
    ),
  });

export const normalizedBasicCoworkReservationProductSchema = Schema.Struct({
  entryTier: Schema.Literal("basic" satisfies WorkspaceCoworkHistoricalTier),
  coffee: Schema.Boolean,
  monitorOption: Schema.optional(Schema.Never),
});

export const normalizedPlusCoworkReservationProductSchema = Schema.Struct({
  entryTier: Schema.Literal("plus" satisfies WorkspaceCoworkHistoricalTier),
  coffee: Schema.Literal(true),
  monitorOption: Schema.optional(Schema.Never),
});

export const normalizedProfiCoworkReservationProductSchema = Schema.Struct({
  entryTier: Schema.Literal("profi" satisfies WorkspaceCoworkHistoricalTier),
  coffee: Schema.Literal(true),
  monitorOption: Schema.Literals(workspaceProductMonitorOptions),
});

export const normalizedCoworkReservationProductSchema = Schema.Union([
  normalizedOpenSpaceCoworkReservationProductSchema,
  normalizedReservedDeskCoworkReservationProductSchema,
  normalizedBasicCoworkReservationProductSchema,
  normalizedPlusCoworkReservationProductSchema,
  normalizedProfiCoworkReservationProductSchema,
]).annotate({
  identifier: "NormalizedCoworkReservationProduct",
  description:
    "Canonical cowork product selection after tier-specific normalization.",
});

const storedOpenSpaceCoworkReservationDetailsSchema = Schema.Struct({
  kind: workspaceCoworkProductIdentitySchema.fields.kind,
  ...normalizedOpenSpaceCoworkReservationProductSchema.fields,
});

const storedReservedDeskCoworkReservationDetailsSchema = Schema.Struct({
  kind: workspaceCoworkProductIdentitySchema.fields.kind,
  ...normalizedReservedDeskCoworkReservationProductSchema.fields,
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
  storedOpenSpaceCoworkReservationDetailsSchema,
  storedReservedDeskCoworkReservationDetailsSchema,
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

export const getAllowedMonitorOptionsForCoworkTier = (
  tier: WorkspaceCoworkProductTier
) => getWorkspaceProductByTier(tier).allowedMonitorOptions;

export const getCoworkReservationProductIssues = (
  data: CoworkReservationProductInput
): readonly Schema.FilterIssue[] => {
  const workstationAddon = getCoworkTierWorkstationAddon(data.entryTier);
  const monitorOption = normalizeMonitorOption(data.monitorOption);

  if (workstationAddon === "required" && !monitorOption) {
    return [
      {
        path: ["monitorOption"],
        issue: m.reservationValidationMonitorRequired(),
      },
    ];
  }

  if (
    workstationAddon !== "unavailable" &&
    monitorOption &&
    !getAllowedMonitorOptionsForCoworkTier(data.entryTier).some(
      (allowed) => allowed === monitorOption
    )
  ) {
    return [
      {
        path: ["monitorOption"],
        issue: m.reservationValidationMonitorUnavailable(),
      },
    ];
  }

  if (workstationAddon === "unavailable" && monitorOption) {
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
    Match.when("open-space", () =>
      normalizedOpenSpaceCoworkReservationProductSchema.make({
        entryTier: "open-space",
        coffee: data.coffee,
      })
    ),
    Match.when("reserved-desk", () =>
      normalizedReservedDeskCoworkReservationProductSchema.make({
        entryTier: "reserved-desk",
        coffee: true,
        monitorOption: normalizeMonitorOption(data.monitorOption),
      })
    ),
    // Historical tiers keep their original normalization for total decodability.
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
      "open-space": (openSpaceProduct) =>
        storedOpenSpaceCoworkReservationDetailsSchema.make({
          kind: coworkReservationKind,
          entryTier: openSpaceProduct.entryTier,
          coffee: openSpaceProduct.coffee,
        }),
      "reserved-desk": (reservedDeskProduct) =>
        storedReservedDeskCoworkReservationDetailsSchema.make({
          kind: coworkReservationKind,
          entryTier: reservedDeskProduct.entryTier,
          coffee: true,
          monitorOption: reservedDeskProduct.monitorOption,
        }),
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
      "open-space": (openSpaceDetails) => ({
        productTier: openSpaceDetails.entryTier,
        productCoffee: openSpaceDetails.coffee,
        productMonitorOption: null,
      }),
      "reserved-desk": (reservedDeskDetails) => ({
        productTier: reservedDeskDetails.entryTier,
        productCoffee: reservedDeskDetails.coffee,
        productMonitorOption: reservedDeskDetails.monitorOption ?? null,
      }),
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

export type {
  WorkspaceCoworkCurrentTier,
  WorkspaceCoworkProductTier,
  WorkspaceProductMonitorOption,
};
