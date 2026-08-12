import { Schema } from "effect";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import {
  instantStringSchema,
  temporalInstantToIsoString,
} from "@/shared/utils/temporal";
import {
  type AccountingDocumentSnapshot,
  accountingDocumentIdentitySchema,
  companyRegistrationIdSchema,
  coworkAccountingDocumentSnapshotSchema,
  meetingRoomAccountingDocumentSnapshotSchema,
  officeAccountingDocumentSnapshotSchema,
  vatRegistrationIdSchema,
} from "./accounting-document-snapshot";

export const invoiceNumberSchema = Schema.String.pipe(
  Schema.brand("InvoiceNumber")
).annotate({
  identifier: "InvoiceNumber",
  description: "Deskohub invoice number.",
});

export type InvoiceNumber = typeof invoiceNumberSchema.Type;

const invoiceBillingTextSchema = Schema.Trim.check(Schema.isNonEmpty());

const invoiceBuyerAddressSchema = Schema.Struct({
  line1: invoiceBillingTextSchema,
  line2: Schema.optionalKey(invoiceBillingTextSchema),
  city: invoiceBillingTextSchema,
  postalCode: invoiceBillingTextSchema,
  country: invoiceBillingTextSchema,
});

export const invoiceBuyerSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("person"),
    legalName: invoiceBillingTextSchema,
    address: invoiceBuyerAddressSchema,
  }),
  Schema.Struct({
    kind: Schema.Literal("business"),
    legalName: invoiceBillingTextSchema,
    companyId: companyRegistrationIdSchema,
    vatId: Schema.optionalKey(vatRegistrationIdSchema),
    address: invoiceBuyerAddressSchema,
  }),
]).annotate({
  identifier: "InvoiceBuyer",
  description: "Complete immutable billing identity of an issued invoice.",
});

export type InvoiceBuyer = typeof invoiceBuyerSchema.Type;

const invoiceIdentitySchema = Schema.Struct({
  ...accountingDocumentIdentitySchema.fields,
  buyer: invoiceBuyerSchema,
  supplier: Schema.Struct({
    ...accountingDocumentIdentitySchema.fields.supplier.fields,
    commercialRegister: Schema.optional(
      Schema.Struct({
        court: Schema.NonEmptyString,
        section: Schema.NonEmptyString,
        file: Schema.NonEmptyString,
      })
    ),
  }),
  paymentAttemptId: Schema.NonEmptyString,
  invoiceNumber: invoiceNumberSchema,
  issuedAt: instantStringSchema,
  paidAt: Schema.optional(instantStringSchema),
});

const coworkInvoiceDocumentSchema = Schema.Struct({
  ...invoiceIdentitySchema.fields,
  reservation: coworkAccountingDocumentSnapshotSchema.fields.reservation,
  quote: coworkAccountingDocumentSnapshotSchema.fields.quote,
});

const meetingRoomInvoiceDocumentSchema = Schema.Struct({
  ...invoiceIdentitySchema.fields,
  reservation: meetingRoomAccountingDocumentSnapshotSchema.fields.reservation,
  quote: meetingRoomAccountingDocumentSnapshotSchema.fields.quote,
});

const officeInvoiceDocumentSchema = Schema.Struct({
  ...invoiceIdentitySchema.fields,
  reservation: officeAccountingDocumentSnapshotSchema.fields.reservation,
  quote: officeAccountingDocumentSnapshotSchema.fields.quote,
});

export const invoiceDocumentSchema = Schema.Union([
  coworkInvoiceDocumentSchema,
  meetingRoomInvoiceDocumentSchema,
  officeInvoiceDocumentSchema,
]).annotate({
  identifier: "InvoiceDocument",
  description:
    "Immutable facts of an issued invoice, independent of mutable customer data.",
});

export type InvoiceDocument = typeof invoiceDocumentSchema.Type;

const decodeInvoiceNumber = Schema.decodeUnknownSync(invoiceNumberSchema);
export const decodeInvoiceDocument = Schema.decodeUnknownEffect(
  invoiceDocumentSchema,
  { onExcessProperty: "error" }
);

export const getInvoiceNumberingYear = (issuedAt: Temporal.Instant) =>
  issuedAt.toZonedDateTimeISO(workspaceSiteConstants.location.timeZone).year;

export const formatInvoiceNumber = (input: {
  readonly year: number;
  readonly sequence: number;
}): InvoiceNumber => {
  if (
    !Number.isInteger(input.year) ||
    !Number.isInteger(input.sequence) ||
    input.sequence < 1
  ) {
    throw new RangeError("Invoice number components are outside their range.");
  }

  return decodeInvoiceNumber(
    `WS-FV-${input.year}-${input.sequence.toString().padStart(6, "0")}`
  );
};

export const makeInvoiceDocument = (input: {
  readonly source: AccountingDocumentSnapshot;
  readonly buyer: InvoiceBuyer;
  readonly paymentAttemptId: string;
  readonly invoiceNumber: InvoiceNumber;
  readonly issuedAt: Temporal.Instant;
  readonly paidAt: Temporal.Instant;
}): InvoiceDocument => {
  return invoiceDocumentSchema.make({
    ...input.source,
    supplier: {
      ...input.source.supplier,
      commercialRegister: workspaceSiteConstants.company.commercialRegister,
    },
    buyer: input.buyer,
    paymentAttemptId: input.paymentAttemptId,
    invoiceNumber: input.invoiceNumber,
    issuedAt: instantStringSchema.make(
      temporalInstantToIsoString(input.issuedAt)
    ),
    paidAt: instantStringSchema.make(temporalInstantToIsoString(input.paidAt)),
  });
};
