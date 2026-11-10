import { getCodes } from "country-list";
import { Schema } from "effect";
import validator from "validator";

/**
 * The billing identity rules a customer can break, carried as each check's
 * message. They name the rule, not its copy: this module also backs the
 * database schema and E2E diagnostics, which run without compiled messages,
 * so the form that shows an issue localizes it.
 */
export const billingIdentityIssue = {
  required: "billing-identity.required",
  countryInvalid: "billing-identity.country-invalid",
  postalCodeInvalid: "billing-identity.postal-code-invalid",
} as const;
export type BillingIdentityIssue =
  (typeof billingIdentityIssue)[keyof typeof billingIdentityIssue];

const billingTextSchema = (maximumLength: number) =>
  Schema.Trim.check(
    Schema.isNonEmpty({ message: billingIdentityIssue.required }),
    Schema.isMaxLength(maximumLength)
  );

export const companyRegistrationIdSchema = billingTextSchema(255)
  .pipe(Schema.brand("CompanyRegistrationId"))
  .annotate({
    identifier: "CompanyRegistrationId",
    description: "Company registration identifier used on accounting records.",
  });

export const vatRegistrationIdSchema = billingTextSchema(255)
  .pipe(Schema.brand("VatRegistrationId"))
  .annotate({
    identifier: "VatRegistrationId",
    description: "VAT registration identifier used on accounting records.",
  });

export const invoiceCountryCodes = getCodes().sort();
const invoiceCountryCodeSet = new Set(invoiceCountryCodes);
const postalCodeLocaleSet = new Set<string>(validator.isPostalCodeLocales);

const invoiceCountryCodeSchema = billingTextSchema(2).check(
  Schema.makeFilter((country) => invoiceCountryCodeSet.has(country), {
    message: billingIdentityIssue.countryInvalid,
  })
);

export const invoiceBuyerAddressSchema = Schema.Struct({
  line1: billingTextSchema(180),
  line2: Schema.optional(billingTextSchema(180)),
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
          issue: billingIdentityIssue.postalCodeInvalid,
        }
  )
);
export type InvoiceBuyerAddress = typeof invoiceBuyerAddressSchema.Type;
export type InvoiceBuyerAddressInput = typeof invoiceBuyerAddressSchema.Encoded;

const personalInvoiceBuyerSchema = Schema.Struct({
  kind: Schema.Literal("person"),
  legalName: billingTextSchema(180),
  address: invoiceBuyerAddressSchema,
});

export const businessInvoiceBuyerSchema = Schema.Struct({
  kind: Schema.Literal("business"),
  legalName: billingTextSchema(180),
  companyId: companyRegistrationIdSchema,
  vatId: Schema.optional(vatRegistrationIdSchema),
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
