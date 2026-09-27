import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Schema } from "effect";

const percentageField = Schema.String.check(
  Schema.isNonEmpty({ message: "Enter a percentage." }),
  Schema.makeFilter(
    (value) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed >= 0.01 && parsed <= 100;
    },
    { message: "Enter a percentage between 0.01 and 100." }
  )
);

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
      value === "" || (Number.isSafeInteger(Number(value)) && Number(value) >= 1),
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

const discountDefinitionFields = {
  labelEn: Schema.String.check(
    Schema.isNonEmpty({ message: "Enter an English label." })
  ),
  labelCs: Schema.String.check(
    Schema.isNonEmpty({ message: "Enter a Czech label." })
  ),
  adjustmentKind: Schema.Literal("percentage", "fixed"),
  percentage: percentageField,
  fixedAmountValue: minorUnitsField,
  fixedAmountCurrency: currencyField,
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

export const discountDefinitionFormSchema = Schema.toStandardSchemaV1(
  Schema.Struct(discountDefinitionFields),
  { parseOptions: { errors: "all" } }
);

export const discountCodeConfigurationFormSchema = Schema.toStandardSchemaV1(
  Schema.Struct(discountCodeConfigurationFields),
  { parseOptions: { errors: "all" } }
);

export const discountCodeFormSchema = Schema.toStandardSchemaV1(
  Schema.Struct({
    discountId: discountIdField,
    ...discountCodeConfigurationFields,
  }),
  { parseOptions: { errors: "all" } }
);

export const voucherFormSchema = Schema.toStandardSchemaV1(
  Schema.Struct({
    ...voucherCreditFields,
    code: discountCodeConfigurationFields.code,
    enabled: discountCodeConfigurationFields.enabled,
    validFrom: discountCodeConfigurationFields.validFrom,
    validUntil: discountCodeConfigurationFields.validUntil,
  }),
  { parseOptions: { errors: "all" } }
);

type DiscountCodeCreationFormShape = {
  readonly discountKind: "existing" | "new";
  readonly discountId: string;
  readonly labelEn: string;
  readonly labelCs: string;
};

export const discountCodeCreationFormSchema = Schema.toStandardSchemaV1(
  Schema.Struct({
    discountKind: Schema.Literal("existing", "new"),
    discountId: Schema.String,
    ...discountDefinitionFields,
    ...discountCodeConfigurationFields,
  }).check(
    Schema.makeFilter<DiscountCodeCreationFormShape>(
      (values) =>
        values.discountKind !== "existing" ||
        values.discountId.trim().length > 0 || {
          path: ["discountId"],
          issue: "Choose a discount.",
        }
    ),
    Schema.makeFilter<DiscountCodeCreationFormShape>(
      (values) =>
        values.discountKind !== "new" ||
        values.labelEn.trim().length > 0 || {
          path: ["labelEn"],
          issue: "Enter an English label.",
        }
    ),
    Schema.makeFilter<DiscountCodeCreationFormShape>(
      (values) =>
        values.discountKind !== "new" ||
        values.labelCs.trim().length > 0 || {
          path: ["labelCs"],
          issue: "Enter a Czech label.",
        }
    )
  )
);

export const customerCodeAudienceFormSchema = Schema.toStandardSchemaV1(
  Schema.Struct({
    customerId: Schema.String.check(
      Schema.isNonEmpty({ message: "Enter a Dotypos customer ID." })
    ),
  })
);

export const customerDiscountGroupFormSchema = Schema.toStandardSchemaV1(
  Schema.Struct({
    discountGroupId: Schema.String,
  })
);

export type DiscountDefinitionFormValues = StandardSchemaV1.InferOutput<
  typeof discountDefinitionFormSchema
>;
export type DiscountCodeConfigurationFormValues = StandardSchemaV1.InferOutput<
  typeof discountCodeConfigurationFormSchema
>;
export type DiscountCodeFormValues = StandardSchemaV1.InferOutput<
  typeof discountCodeFormSchema
>;
export type VoucherFormValues = StandardSchemaV1.InferOutput<
  typeof voucherFormSchema
>;
export type DiscountCodeCreationFormValues = StandardSchemaV1.InferOutput<
  typeof discountCodeCreationFormSchema
>;
export type CustomerCodeAudienceFormValues = StandardSchemaV1.InferOutput<
  typeof customerCodeAudienceFormSchema
>;
export type CustomerDiscountGroupFormValues = StandardSchemaV1.InferOutput<
  typeof customerDiscountGroupFormSchema
>;
