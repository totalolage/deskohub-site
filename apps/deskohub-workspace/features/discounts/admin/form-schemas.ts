import { Schema } from "effect";

const minorUnitsField = Schema.String.check(
  Schema.isNonEmpty({ message: "Enter a value in minor units." }),
  Schema.makeFilter(
    (value) => Number.isSafeInteger(Number(value)) && Number(value) >= 1,
    { message: "Enter a whole number of minor units of at least 1." }
  )
);

const optionalCountField = Schema.String.check(
  Schema.makeFilter(
    (value) =>
      value === "" ||
      (Number.isSafeInteger(Number(value)) && Number(value) >= 1),
    { message: "Enter a whole number of uses." }
  )
);

const optionalLocalDateTimeField = Schema.String.check(
  Schema.makeFilter(
    (value) =>
      value === "" || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value),
    { message: "Choose a valid date and time." }
  )
);

const codeField = Schema.String.check(
  Schema.isNonEmpty({ message: "Enter a discount code." }),
  Schema.makeFilter(
    (value) => {
      const normalized = value.trim();
      return normalized.length >= 3 && normalized.length <= 64;
    },
    { message: "Use 3 to 64 characters for the code." }
  )
);

const currencyField = Schema.String.check(
  Schema.isNonEmpty({ message: "Choose a currency." })
);

const discountIdField = Schema.String.check(
  Schema.isNonEmpty({ message: "Choose a discount." })
);

type DiscountDefinitionCheckValues = {
  readonly adjustmentKind: "percentage" | "fixed";
  readonly labelEn: string;
  readonly labelCs: string;
  readonly percentage: string;
  readonly fixedAmountValue: string;
  readonly fixedAmountCurrency: string;
};

// The inactive adjustment branch keeps its permissive string value, so only
// the checks for the active branch (and, for creation forms, only when the
// "new discount" branch applies) produce issues. Every check is its own
// filter so all failing fields report their message at once.
const definitionFilters = <Values extends DiscountDefinitionCheckValues>(
  applies: (values: Values) => boolean
) =>
  [
    Schema.makeFilter<Values>(
      (values) =>
        !applies(values) ||
        values.labelEn.trim().length > 0 || {
          path: ["labelEn"],
          issue: "Enter an English label.",
        }
    ),
    Schema.makeFilter<Values>(
      (values) =>
        !applies(values) ||
        values.labelCs.trim().length > 0 || {
          path: ["labelCs"],
          issue: "Enter a Czech label.",
        }
    ),
    Schema.makeFilter<Values>(
      (values) =>
        !applies(values) ||
        values.adjustmentKind !== "percentage" ||
        values.percentage.length > 0 || {
          path: ["percentage"],
          issue: "Enter a percentage.",
        }
    ),
    Schema.makeFilter<Values>((values) => {
      if (!applies(values) || values.adjustmentKind !== "percentage")
        return true;
      const parsed = Number(values.percentage);
      return (
        (Number.isFinite(parsed) && parsed >= 0.01 && parsed <= 100) || {
          path: ["percentage"],
          issue: "Enter a percentage between 0.01 and 100.",
        }
      );
    }),
    Schema.makeFilter<Values>(
      (values) =>
        !applies(values) ||
        values.adjustmentKind !== "fixed" ||
        values.fixedAmountValue.length > 0 || {
          path: ["fixedAmountValue"],
          issue: "Enter a value in minor units.",
        }
    ),
    Schema.makeFilter<Values>((values) => {
      if (!applies(values) || values.adjustmentKind !== "fixed") return true;
      const parsed = Number(values.fixedAmountValue);
      return (
        (Number.isSafeInteger(parsed) && parsed >= 1) || {
          path: ["fixedAmountValue"],
          issue: "Enter a whole number of minor units of at least 1.",
        }
      );
    }),
    Schema.makeFilter<Values>(
      (values) =>
        !applies(values) ||
        values.adjustmentKind !== "fixed" ||
        values.fixedAmountCurrency.length > 0 || {
          path: ["fixedAmountCurrency"],
          issue: "Choose a currency.",
        }
    ),
  ] as const;

// Fields stay permissive strings so the form-value shape is stable while a
// different adjustment kind or discount branch is selected.
const permissiveDiscountDefinitionFields = {
  labelEn: Schema.String,
  labelCs: Schema.String,
  adjustmentKind: Schema.Union([
    Schema.Literal("percentage"),
    Schema.Literal("fixed"),
  ]),
  percentage: Schema.String,
  fixedAmountValue: Schema.String,
  fixedAmountCurrency: Schema.String,
  products: Schema.Array(Schema.String),
};

const discountCodeConfigurationFields = {
  code: codeField,
  enabled: Schema.Boolean,
  validFrom: optionalLocalDateTimeField,
  validUntil: optionalLocalDateTimeField,
  maxUses: optionalCountField,
  maxUsesPerCustomer: optionalCountField,
};

const voucherCreditFields = {
  voucherValue: minorUnitsField,
  voucherCurrency: currencyField,
};

export const discountDefinitionFormSchema = Schema.Struct(
  permissiveDiscountDefinitionFields
).check(...definitionFilters<DiscountDefinitionCheckValues>(() => true));

export const discountCodeConfigurationFormSchema = Schema.Struct(
  discountCodeConfigurationFields
);

export const discountCodeFormSchema = Schema.Struct({
  discountId: discountIdField,
  ...discountCodeConfigurationFields,
});

export const voucherFormSchema = Schema.Struct({
  ...voucherCreditFields,
  code: discountCodeConfigurationFields.code,
  enabled: discountCodeConfigurationFields.enabled,
  validFrom: discountCodeConfigurationFields.validFrom,
  validUntil: discountCodeConfigurationFields.validUntil,
});

type DiscountCodeCreationFormCheckInput = DiscountDefinitionCheckValues & {
  readonly discountKind: "existing" | "new";
  readonly discountId: string;
};

export const discountCodeCreationFormSchema = Schema.Struct({
  discountKind: Schema.Union([
    Schema.Literal("existing"),
    Schema.Literal("new"),
  ]),
  discountId: Schema.String,
  ...permissiveDiscountDefinitionFields,
  ...discountCodeConfigurationFields,
}).check(
  Schema.makeFilter<DiscountCodeCreationFormCheckInput>(
    (values) =>
      values.discountKind !== "existing" ||
      values.discountId.trim().length > 0 || {
        path: ["discountId"],
        issue: "Choose a discount.",
      }
  ),
  // Definition, label, and adjustment checks only apply while creating a
  // new discount; the existing-discount branch pairs the code with an
  // already valid discount.
  ...definitionFilters<DiscountCodeCreationFormCheckInput>(
    (values) => values.discountKind === "new"
  )
);

export const customerCodeAudienceFormSchema = Schema.Struct({
  customerId: Schema.String.check(
    Schema.isNonEmpty({ message: "Enter a Dotypos customer ID." })
  ),
});

export const customerDiscountGroupFormSchema = Schema.Struct({
  discountGroupId: Schema.String,
});

export type DiscountDefinitionFormValues =
  typeof discountDefinitionFormSchema.Type;
export type DiscountCodeConfigurationFormValues =
  typeof discountCodeConfigurationFormSchema.Type;
export type DiscountCodeFormValues = typeof discountCodeFormSchema.Type;
export type VoucherFormValues = typeof voucherFormSchema.Type;
export type DiscountCodeCreationFormValues =
  typeof discountCodeCreationFormSchema.Type;
export type CustomerCodeAudienceFormValues =
  typeof customerCodeAudienceFormSchema.Type;
export type CustomerDiscountGroupFormValues =
  typeof customerDiscountGroupFormSchema.Type;
