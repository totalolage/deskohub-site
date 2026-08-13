import { getCodes } from "country-list";
import { Schema } from "effect";
import validator from "validator";
import { m } from "@/features/i18n";

const billingTextSchema = (maximumLength: number) =>
  Schema.Trim.check(Schema.isNonEmpty(), Schema.isMaxLength(maximumLength));

export const companyRegistrationIdSchema = billingTextSchema(255)
  .pipe(Schema.brand("CompanyRegistrationId"))
  .annotate({
    identifier: "CompanyRegistrationId",
    description: "Company registration identifier used on accounting records.",
  });
export type CompanyRegistrationId = typeof companyRegistrationIdSchema.Type;

export const vatRegistrationIdSchema = billingTextSchema(255)
  .pipe(Schema.brand("VatRegistrationId"))
  .annotate({
    identifier: "VatRegistrationId",
    description: "VAT registration identifier used on accounting records.",
  });
export type VatRegistrationId = typeof vatRegistrationIdSchema.Type;

export const invoiceCountryCodes = getCodes().sort();
const invoiceCountryCodeSet = new Set(invoiceCountryCodes);
const postalCodeLocaleSet = new Set<string>(validator.isPostalCodeLocales);

const invoiceCountryCodeSchema = billingTextSchema(2).check(
  Schema.makeFilter((country) => invoiceCountryCodeSet.has(country), {
    message: m.reservationBillingCountryInvalid(),
  })
);

export const invoiceBuyerAddressSchema = Schema.Struct({
  line1: billingTextSchema(180),
  line2: Schema.optionalKey(billingTextSchema(180)),
  city: billingTextSchema(255),
  postalCode: billingTextSchema(20),
  country: invoiceCountryCodeSchema,
}).check(
  Schema.makeFilter(({ country, postalCode }) =>
    !postalCodeLocaleSet.has(country) ||
    validator.isPostalCode(
      postalCode,
      country as Parameters<typeof validator.isPostalCode>[1]
    )
      ? true
      : {
          path: ["postalCode"],
          issue: m.reservationBillingPostalCodeInvalid(),
        }
  )
);

export const personalInvoiceBuyerSchema = Schema.Struct({
  kind: Schema.Literal("person"),
  legalName: billingTextSchema(180),
  address: invoiceBuyerAddressSchema,
});
export type PersonalInvoiceBuyer = typeof personalInvoiceBuyerSchema.Type;

export const businessInvoiceBuyerSchema = Schema.Struct({
  kind: Schema.Literal("business"),
  legalName: billingTextSchema(180),
  companyId: companyRegistrationIdSchema,
  vatId: Schema.optionalKey(vatRegistrationIdSchema),
  address: invoiceBuyerAddressSchema,
});
export type BusinessInvoiceBuyer = typeof businessInvoiceBuyerSchema.Type;

export const invoiceBuyerSchema = Schema.Union([
  personalInvoiceBuyerSchema,
  businessInvoiceBuyerSchema,
]).annotate({
  identifier: "InvoiceBuyer",
  description: "Complete immutable billing identity of an issued invoice.",
});
export type InvoiceBuyer = typeof invoiceBuyerSchema.Type;
