import { Schema } from "effect";
import type { AdministrationCampaignLocale } from "./campaign-locale-and-purpose";
import { DatePeriod } from "./date-period";
import { AdministrationReservationFamily } from "./workspace-admin-api";

/** How a count attribute compares with the condition's number. */
export const AudienceCountOperator = Schema.Literals([
  "eq",
  "ne",
  "lt",
  "lte",
  "gt",
  "gte",
]);
export type AudienceCountOperator = typeof AudienceCountOperator.Type;

/**
 * A date attribute's value lies in the period (`in`), exists outside it
 * (`notIn`), or doesn't exist (`none`).
 */
export const AudienceDateOperator = Schema.Literals(["in", "notIn", "none"]);
export type AudienceDateOperator = typeof AudienceDateOperator.Type;

/** A set attribute includes any, all, or none of the chosen values. */
export const AudienceSetOperator = Schema.Literals([
  "anyOf",
  "allOf",
  "noneOf",
]);
export type AudienceSetOperator = typeof AudienceSetOperator.Type;

const count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/** Comparisons with zero that hold for nobody or for everyone. */
const degenerateZeroComparisons: Partial<
  Readonly<Record<AudienceCountOperator, string>>
> = {
  lt: "“< 0” never matches. Use “= 0” for none.",
  gte: "“≥ 0” always matches. Use “≥ 1” for any, or remove the condition.",
};

/**
 * Counts are never negative, so "< 0" matches nobody and "≥ 0" everyone.
 * Both are rejected on the operator, with the comparison the admin likely
 * meant.
 */
const meaningfulComparison = Schema.makeFilter(
  ({
    operator,
    value,
  }: {
    readonly operator: AudienceCountOperator;
    readonly value: number;
  }) => {
    const issue = value === 0 ? degenerateZeroComparisons[operator] : undefined;
    return issue && { path: ["operator"], issue };
  }
);

/** One count comparison: an operator and a non-negative whole number. */
export const audienceCountComparisonFields = {
  operator: AudienceCountOperator,
  value: count,
} as const;

const chosen = <Value extends Schema.Top>(value: Value) =>
  // An empty choice is typeable, so the Admin UI can hold one while the
  // operator picks values, but it never decodes.
  Schema.Array(value).check(Schema.isMinLength(1));

/**
 * One condition on a catalog property of a reservation product: an enum
 * property is any or none of its values, a boolean property is true or
 * false, and a number property compares like a count. Workspace checks the
 * property and its values against its reservation product catalog.
 */
export const ReservationProductPropertyCondition = Schema.Union([
  Schema.Struct({
    property: Schema.NonEmptyString,
    operator: Schema.Literals(["anyOf", "noneOf"]),
    value: chosen(Schema.NonEmptyString),
  }),
  Schema.Struct({
    property: Schema.NonEmptyString,
    operator: Schema.Literal("is"),
    value: Schema.Boolean,
  }),
  Schema.Struct({
    property: Schema.NonEmptyString,
    ...audienceCountComparisonFields,
  }).check(meaningfulComparison),
]);
export type ReservationProductPropertyCondition =
  typeof ReservationProductPropertyCondition.Type;

/**
 * Limits reservation-based attributes to one product family, and optionally
 * to reservations whose catalog properties all meet their conditions.
 */
export const ReservationProductFilter = Schema.Struct({
  family: AdministrationReservationFamily,
  properties: Schema.Array(ReservationProductPropertyCondition),
}).annotate({
  identifier: "ReservationProductFilter",
  description:
    "A reservation product family and conditions on its catalog properties.",
});
export type ReservationProductFilter = typeof ReservationProductFilter.Type;

/** Where the Admin UI lists an attribute, in menu order. */
export const audienceAttributeSections = [
  "Reservations",
  "Emails",
  "Account",
  "Profile",
] as const;
export type AudienceAttributeSection =
  (typeof audienceAttributeSections)[number];

/**
 * A parameter of a count attribute that picks one of a few values, such as
 * the date basis or campaign purpose. `field` is its struct field schema and
 * `options` its values in control order; an optional choice can be unset.
 */
export type AudienceChoiceParam<
  Field extends Schema.Top = Schema.Top,
  Value extends string = string,
> = {
  readonly part: "choice";
  readonly field: Field;
  readonly control: "select" | "toggle";
  readonly options: readonly Value[];
  readonly optional: boolean;
};

type ChoiceSchema = Schema.Top & { readonly Type: string };

export const choiceParam = <Choice extends ChoiceSchema>(
  schema: Choice,
  presentation: Pick<
    AudienceChoiceParam<Choice, Choice["Type"]>,
    "control" | "options"
  >
): AudienceChoiceParam<Choice, Choice["Type"]> => ({
  part: "choice",
  field: schema,
  ...presentation,
  optional: false,
});

export const optionalChoiceParam = <Choice extends ChoiceSchema>(
  schema: Choice,
  presentation: Pick<
    AudienceChoiceParam<Schema.optionalKey<Choice>, Choice["Type"]>,
    "control" | "options"
  >
): AudienceChoiceParam<Schema.optionalKey<Choice>, Choice["Type"]> => ({
  part: "choice",
  field: Schema.optionalKey(schema),
  ...presentation,
  optional: true,
});

/** The period a count attribute counts in; every count attribute has one. */
export const periodParam = { part: "period", field: DatePeriod } as const;
export type AudiencePeriodParam = typeof periodParam;

export type AudienceParam = AudienceChoiceParam | AudiencePeriodParam;

type CountParams = { readonly [param: string]: AudienceParam } & {
  readonly period: AudiencePeriodParam;
};

/**
 * The English name `dhw` and the API schema describe an attribute by, and its
 * Admin UI menu section. The Admin UI's own wording lives in Workspace.
 */
type Presentation = {
  readonly label: string;
  readonly section: AudienceAttributeSection;
};

/**
 * One condition shape of one attribute. `attribute` comes before `_tag`
 * because a union dispatches on the first literal key it indexes: with
 * `attribute` first, a condition is checked only against its own attribute's
 * shapes, so validation errors point at its fields rather than at every
 * attribute's.
 */
const conditionShape = <
  const Attribute extends string,
  const Fields extends Schema.Struct.Fields,
>(
  attribute: Attribute,
  fields: Fields
) =>
  Schema.Struct({
    attribute: Schema.Literal(attribute),
    _tag: Schema.tag("Condition"),
    ...fields,
  });

/** A condition without its `attribute` and `_tag`: what an entry defaults to. */
type DefaultsOf<Shapes extends readonly Schema.Top[]> =
  Shapes[number]["Type"] extends infer Condition
    ? Condition extends unknown
      ? Omit<Condition, "attribute" | "_tag">
      : never
    : never;

const productField = Schema.optionalKey(ReservationProductFilter);

type ProductFields<Product extends boolean> = Product extends true
  ? { readonly product: typeof productField }
  : Record<never, never>;

const productFields = <Product extends boolean>(product: Product | undefined) =>
  (product ? { product: productField } : {}) as ProductFields<Product>;

type Simplify<T> = { readonly [Key in keyof T]: T[Key] };

type CountParamsFields<
  Params extends CountParams,
  Product extends boolean,
> = Simplify<
  {
    readonly [Param in keyof Params]: Params[Param]["field"];
  } & ProductFields<Product>
>;

const countParamsFields = <Params extends CountParams, Product extends boolean>(
  params: Params,
  product: Product | undefined
) =>
  ({
    ...Object.fromEntries(
      Object.entries(params).map(([key, param]) => [key, param.field])
    ),
    ...productFields(product),
  }) as CountParamsFields<Params, Product>;

/**
 * A count attribute, such as reservations or campaign emails received. Its
 * params are its choice parameters and period, in wire order, then, for
 * reservation-based attributes, an optional product filter.
 */
export const countAttribute = <
  const Attribute extends string,
  const Params extends CountParams,
  const Product extends boolean = false,
>(
  attribute: Attribute,
  definition: Presentation & {
    readonly params: Params;
    readonly reservationProduct?: Product;
    readonly defaults: NoInfer<{
      readonly params: Schema.Struct<
        CountParamsFields<Params, Product>
      >["Type"];
      readonly operator: AudienceCountOperator;
      readonly value: number;
    }>;
  }
) => ({
  kind: "count" as const,
  attribute,
  ...definition,
  reservationProduct: definition.reservationProduct ?? false,
  conditions: [
    conditionShape(attribute, {
      params: Schema.Struct(
        countParamsFields(definition.params, definition.reservationProduct)
      ),
      ...audienceCountComparisonFields,
    }).check(meaningfulComparison),
  ] as const,
});

type DateParamsFields<Product extends boolean> = Product extends true
  ? {
      readonly params: Schema.optionalKey<
        Schema.Struct<{ readonly product: typeof ReservationProductFilter }>
      >;
    }
  : Record<never, never>;

/**
 * A date attribute, such as the last visit. A condition puts its value in a
 * period, outside one, or requires it to be missing.
 */
export const dateAttribute = <
  const Attribute extends string,
  const Product extends boolean = false,
>(
  attribute: Attribute,
  definition: Presentation & {
    readonly reservationProduct?: Product;
    readonly defaults:
      | { readonly operator: "in" | "notIn"; readonly value: DatePeriod }
      | { readonly operator: "none" };
  }
) => {
  const params = (
    definition.reservationProduct
      ? {
          params: Schema.optionalKey(
            Schema.Struct({ product: ReservationProductFilter })
          ),
        }
      : {}
  ) as DateParamsFields<Product>;
  return {
    kind: "date" as const,
    attribute,
    ...definition,
    reservationProduct: definition.reservationProduct ?? false,
    conditions: [
      conditionShape(attribute, {
        ...params,
        operator: Schema.Literals(["in", "notIn"]),
        value: DatePeriod,
      }),
      conditionShape(attribute, {
        ...params,
        operator: Schema.Literal("none"),
      }),
    ] as const,
  };
};

/**
 * Where a set attribute's values come from in the Admin UI: a fixed list of
 * options, free text, or a list Workspace looks up (with free text when the
 * lookup isn't available).
 */
export type AudienceSetValues<Value extends string = string> =
  | { readonly _tag: "Options"; readonly options: readonly Value[] }
  | { readonly _tag: "FreeText" }
  | { readonly _tag: "Lookup"; readonly lookup: AudienceValueLookup };

/** Value lists Workspace loads for the Admin UI and summaries. */
export type AudienceValueLookup = "discountGroups";

/** A fixed list of options, in control order. */
export const optionValues = <Choice extends ChoiceSchema>(
  schema: Choice,
  options: readonly Choice["Type"][]
) => ({
  schema,
  presentation: { _tag: "Options" as const, options },
});

export const freeTextValues = () => ({
  schema: Schema.NonEmptyString,
  presentation: { _tag: "FreeText" as const },
});

export const lookupValues = (lookup: AudienceValueLookup) => ({
  schema: Schema.NonEmptyString,
  presentation: { _tag: "Lookup" as const, lookup },
});

/**
 * A set attribute, such as Dotypos tags. `narrowsLocales` marks an attribute
 * whose values are the recipient's campaign locale, so campaign content needs
 * only those.
 */
export const setAttribute = <
  const Attribute extends string,
  Value extends ChoiceSchema,
  const Operators extends readonly [
    AudienceSetOperator,
    ...AudienceSetOperator[],
  ],
>(
  attribute: Attribute,
  definition: Presentation & {
    readonly values: {
      readonly schema: Value;
      readonly presentation: AudienceSetValues<Value["Type"]>;
    };
    readonly operators: Operators;
    readonly narrowsLocales?: Value["Type"] extends AdministrationCampaignLocale
      ? boolean
      : false;
    readonly defaults: NoInfer<{
      readonly operator: Operators[number];
      readonly value: readonly Value["Type"][];
    }>;
  }
) => ({
  kind: "set" as const,
  attribute,
  ...definition,
  values: definition.values.presentation,
  narrowsLocales: definition.narrowsLocales ?? false,
  conditions: [
    conditionShape(attribute, {
      operator: Schema.Literals(definition.operators),
      value: chosen(definition.values.schema),
    }),
  ] as const,
});

/** A yes-or-no attribute, such as having a Workspace account. */
export const booleanAttribute = <const Attribute extends string>(
  attribute: Attribute,
  definition: Presentation & {
    readonly defaults: {
      readonly operator: "is";
      readonly value: boolean;
    };
  }
) => ({
  kind: "boolean" as const,
  attribute,
  ...definition,
  conditions: [
    conditionShape(attribute, {
      operator: Schema.Literal("is"),
      value: Schema.Boolean,
    }),
  ] as const,
});

type ConditionShapes = readonly [
  Schema.Codec<unknown, unknown>,
  ...Schema.Codec<unknown, unknown>[],
];

type ConditionBase = {
  readonly attribute: string;
  readonly _tag: "Condition";
};

/** What every condition of a kind has, whatever its attribute. */
export type AudienceCountCondition = ConditionBase & {
  readonly params: {
    readonly period: DatePeriod;
    readonly product?: ReservationProductFilter;
    readonly [param: string]: unknown;
  };
  readonly operator: AudienceCountOperator;
  readonly value: number;
};

export type AudienceDateCondition = ConditionBase & {
  readonly params?: { readonly product: ReservationProductFilter };
} & (
    | { readonly operator: "in" | "notIn"; readonly value: DatePeriod }
    | { readonly operator: "none" }
  );

export type AudienceSetCondition = ConditionBase & {
  readonly operator: AudienceSetOperator;
  readonly value: readonly string[];
};

export type AudienceBooleanCondition = ConditionBase & {
  readonly operator: "is";
  readonly value: boolean;
};

/** What every catalogue entry of a kind has, whatever its attribute. */
export type AudienceCountAttributeDefinition = Presentation & {
  readonly kind: "count";
  readonly attribute: string;
  readonly params: { readonly [param: string]: AudienceParam };
  readonly reservationProduct: boolean;
  readonly defaults: object;
  readonly conditions: ConditionShapes;
};

export type AudienceDateAttributeDefinition = Presentation & {
  readonly kind: "date";
  readonly attribute: string;
  readonly reservationProduct: boolean;
  readonly defaults: object;
  readonly conditions: ConditionShapes;
};

export type AudienceSetAttributeDefinition = Presentation & {
  readonly kind: "set";
  readonly attribute: string;
  readonly values: AudienceSetValues;
  readonly operators: readonly AudienceSetOperator[];
  readonly narrowsLocales: boolean;
  readonly defaults: object;
  readonly conditions: ConditionShapes;
};

export type AudienceBooleanAttributeDefinition = Presentation & {
  readonly kind: "boolean";
  readonly attribute: string;
  readonly defaults: object;
  readonly conditions: ConditionShapes;
};

export type AudienceAttributeDefinition =
  | AudienceCountAttributeDefinition
  | AudienceDateAttributeDefinition
  | AudienceSetAttributeDefinition
  | AudienceBooleanAttributeDefinition;

export type AudienceAttributeKind = AudienceAttributeDefinition["kind"];

/**
 * Checks that every entry is keyed by its own attribute. The attribute
 * catalogue, and any catalogue a test extends it into, goes through it.
 */
export const defineAudienceAttributeCatalogue = <
  const Catalogue extends {
    readonly [Attribute in keyof Catalogue]: AudienceAttributeDefinition & {
      readonly attribute: Attribute;
    };
  },
>(
  catalogue: Catalogue
) => catalogue;

/** A catalogue's conditions, one union member per attribute shape. */
export type AudienceConditionIn<
  Catalogue extends {
    readonly [Attribute in keyof Catalogue]: {
      readonly conditions: ConditionShapes;
    };
  },
> = {
  readonly [Attribute in keyof Catalogue]: Catalogue[Attribute]["conditions"][number]["Type"];
}[keyof Catalogue];

/** The condition defaults of one entry, for a new condition. */
export type AudienceConditionDefaults<
  Definition extends { readonly conditions: ConditionShapes },
> = DefaultsOf<Definition["conditions"]>;
