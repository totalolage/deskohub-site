import { Schema } from "effect";
import { m } from "@/features/administration/i18n";
import {
  findWorkspaceProductTargetsIssue,
  type WorkspaceProductTargetKey,
} from "@/features/discounts/product-target";
import type { Locale } from "@/features/i18n";
import {
  discountProductTargetKeys,
  toDiscountProductTargets,
} from "./product-target-options";

const minorUnitsField = (locale: Locale) =>
  Schema.String.check(
    Schema.isNonEmpty({
      message: m.discountsValidationMinorUnitsRequired({}, { locale }),
    }),
    Schema.makeFilter(
      (value) => Number.isSafeInteger(Number(value)) && Number(value) >= 1,
      { message: m.discountsValidationMinorUnitsWhole({}, { locale }) }
    )
  );

const optionalCountField = (locale: Locale) =>
  Schema.String.check(
    Schema.makeFilter(
      (value) =>
        value === "" ||
        (Number.isSafeInteger(Number(value)) && Number(value) >= 1),
      { message: m.discountsValidationUsesWhole({}, { locale }) }
    )
  );

const optionalLocalDateTimeField = (locale: Locale) =>
  Schema.String.check(
    Schema.makeFilter(
      (value) =>
        value === "" || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value),
      { message: m.discountsValidationDateTime({}, { locale }) }
    )
  );

const codeField = (locale: Locale) =>
  Schema.String.check(
    Schema.isNonEmpty({
      message: m.discountsValidationCodeRequired({}, { locale }),
    }),
    Schema.makeFilter(
      (value) => {
        const normalized = value.trim();
        return normalized.length >= 3 && normalized.length <= 64;
      },
      { message: m.discountsValidationCodeLength({}, { locale }) }
    )
  );

const currencyField = (locale: Locale) =>
  Schema.String.check(
    Schema.isNonEmpty({
      message: m.discountsValidationCurrencyRequired({}, { locale }),
    })
  );

const discountIdField = (locale: Locale) =>
  Schema.String.check(
    Schema.isNonEmpty({
      message: m.discountsValidationDiscountRequired({}, { locale }),
    })
  );

type DiscountDefinitionCheckValues = {
  readonly adjustmentKind: "percentage" | "fixed";
  readonly labelEn: string;
  readonly labelCs: string;
  readonly percentage: string;
  readonly fixedAmountValue: string;
  readonly fixedAmountCurrency: string;
  readonly products: readonly WorkspaceProductTargetKey[];
};

// The inactive adjustment branch keeps its permissive string value, so only
// the checks for the active branch (and, for creation forms, only when the
// "new discount" branch applies) produce issues. Every check is its own
// filter so all failing fields report their message at once.
const definitionFilters = <Values extends DiscountDefinitionCheckValues>(
  locale: Locale,
  applies: (values: Values) => boolean
) =>
  [
    Schema.makeFilter<Values>(
      (values) =>
        !applies(values) ||
        values.labelEn.trim().length > 0 || {
          path: ["labelEn"],
          issue: m.discountsValidationEnglishLabelRequired({}, { locale }),
        }
    ),
    Schema.makeFilter<Values>(
      (values) =>
        !applies(values) ||
        values.labelCs.trim().length > 0 || {
          path: ["labelCs"],
          issue: m.discountsValidationCzechLabelRequired({}, { locale }),
        }
    ),
    Schema.makeFilter<Values>(
      (values) =>
        !applies(values) ||
        values.adjustmentKind !== "percentage" ||
        values.percentage.length > 0 || {
          path: ["percentage"],
          issue: m.discountsValidationPercentageRequired({}, { locale }),
        }
    ),
    Schema.makeFilter<Values>((values) => {
      if (!applies(values) || values.adjustmentKind !== "percentage")
        return true;
      const parsed = Number(values.percentage);
      return (
        (Number.isFinite(parsed) && parsed >= 0.01 && parsed <= 100) || {
          path: ["percentage"],
          issue: m.discountsValidationPercentageRange({}, { locale }),
        }
      );
    }),
    Schema.makeFilter<Values>(
      (values) =>
        !applies(values) ||
        values.adjustmentKind !== "fixed" ||
        values.fixedAmountValue.length > 0 || {
          path: ["fixedAmountValue"],
          issue: m.discountsValidationMinorUnitsRequired({}, { locale }),
        }
    ),
    Schema.makeFilter<Values>((values) => {
      if (!applies(values) || values.adjustmentKind !== "fixed") return true;
      const parsed = Number(values.fixedAmountValue);
      return (
        (Number.isSafeInteger(parsed) && parsed >= 1) || {
          path: ["fixedAmountValue"],
          issue: m.discountsValidationMinorUnitsWhole({}, { locale }),
        }
      );
    }),
    Schema.makeFilter<Values>(
      (values) =>
        !applies(values) ||
        values.adjustmentKind !== "fixed" ||
        values.fixedAmountCurrency.length > 0 || {
          path: ["fixedAmountCurrency"],
          issue: m.discountsValidationCurrencyRequired({}, { locale }),
        }
    ),
    Schema.makeFilter<Values>(
      (values) =>
        !applies(values) ||
        findWorkspaceProductTargetsIssue(
          toDiscountProductTargets(values.products)
        ) === undefined || {
          path: ["products"],
          issue: m.discountsValidationProductTargets({}, { locale }),
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
  products: Schema.Array(Schema.Literals(discountProductTargetKeys)),
};

const discountCodeConfigurationFields = (locale: Locale) => ({
  code: codeField(locale),
  enabled: Schema.Boolean,
  validFrom: optionalLocalDateTimeField(locale),
  validUntil: optionalLocalDateTimeField(locale),
  maxUses: optionalCountField(locale),
  maxUsesPerCustomer: optionalCountField(locale),
});

export const createDiscountDefinitionFormSchema = (locale: Locale) =>
  Schema.Struct(permissiveDiscountDefinitionFields).check(
    ...definitionFilters<DiscountDefinitionCheckValues>(locale, () => true)
  );

const createDiscountCodeConfigurationFormSchema = (locale: Locale) =>
  Schema.Struct(discountCodeConfigurationFields(locale));

export const createDiscountCodeFormSchema = (locale: Locale) =>
  Schema.Struct({
    discountId: discountIdField(locale),
    ...discountCodeConfigurationFields(locale),
  });

export const createVoucherFormSchema = (locale: Locale) => {
  const { code, enabled, validFrom, validUntil } =
    discountCodeConfigurationFields(locale);
  return Schema.Struct({
    voucherValue: minorUnitsField(locale),
    voucherCurrency: currencyField(locale),
    code,
    enabled,
    validFrom,
    validUntil,
  });
};

type DiscountCodeCreationFormCheckInput = DiscountDefinitionCheckValues & {
  readonly discountKind: "existing" | "new";
  readonly discountId: string;
};

export const createDiscountCodeCreationFormSchema = (locale: Locale) =>
  Schema.Struct({
    discountKind: Schema.Union([
      Schema.Literal("existing"),
      Schema.Literal("new"),
    ]),
    discountId: Schema.String,
    ...permissiveDiscountDefinitionFields,
    ...discountCodeConfigurationFields(locale),
  }).check(
    Schema.makeFilter<DiscountCodeCreationFormCheckInput>(
      (values) =>
        values.discountKind !== "existing" ||
        values.discountId.trim().length > 0 || {
          path: ["discountId"],
          issue: m.discountsValidationDiscountRequired({}, { locale }),
        }
    ),
    // Definition, label, and adjustment checks only apply while creating a
    // new discount; the existing-discount branch pairs the code with an
    // already valid discount.
    ...definitionFilters<DiscountCodeCreationFormCheckInput>(
      locale,
      (values) => values.discountKind === "new"
    )
  );

export const createCustomerCodeAudienceFormSchema = (locale: Locale) =>
  Schema.Struct({
    customerId: Schema.String.check(
      Schema.isNonEmpty({
        message: m.discountsValidationCustomerIdRequired({}, { locale }),
      })
    ),
  });

export const customerDiscountGroupFormSchema = Schema.Struct({
  discountGroupId: Schema.String,
});

export type DiscountDefinitionFormValues = ReturnType<
  typeof createDiscountDefinitionFormSchema
>["Type"];
export type DiscountCodeConfigurationFormValues = ReturnType<
  typeof createDiscountCodeConfigurationFormSchema
>["Type"];
export type DiscountCodeFormValues = ReturnType<
  typeof createDiscountCodeFormSchema
>["Type"];
export type VoucherFormValues = ReturnType<
  typeof createVoucherFormSchema
>["Type"];
export type DiscountCodeCreationFormValues = ReturnType<
  typeof createDiscountCodeCreationFormSchema
>["Type"];
