import { Schema } from "effect";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import {
  instantStringSchema,
  temporalInstantToIsoString,
} from "@/shared/utils/temporal";
import {
  type AccountingDocumentSnapshot,
  accountingDocumentIdentitySchema,
  coworkAccountingDocumentSnapshotSchema,
  meetingRoomAccountingDocumentSnapshotSchema,
  officeAccountingDocumentSnapshotSchema,
} from "./accounting-document-snapshot";
import { type InvoiceBuyer, invoiceBuyerSchema } from "./billing-identity";

export {
  type BusinessInvoiceBuyer,
  businessInvoiceBuyerSchema,
  type InvoiceBuyer,
  invoiceBuyerSchema,
  type PersonalInvoiceBuyer,
  personalInvoiceBuyerSchema,
} from "./billing-identity";

export const invoiceNumberSchema = Schema.String.pipe(
  Schema.brand("InvoiceNumber")
).annotate({
  identifier: "InvoiceNumber",
  description: "Deskohub invoice number.",
});

export type InvoiceNumber = typeof invoiceNumberSchema.Type;

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
  fulfilledAt: Schema.optional(instantStringSchema),
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
  readonly fulfilledAt: Temporal.Instant;
  readonly paidAt: Temporal.Instant;
}): InvoiceDocument => {
  const { billing: _billing, delivery: _delivery, ...source } = input.source;

  return invoiceDocumentSchema.make({
    ...source,
    supplier: {
      ...source.supplier,
      commercialRegister: workspaceSiteConstants.company.commercialRegister,
    },
    buyer: input.buyer,
    paymentAttemptId: input.paymentAttemptId,
    invoiceNumber: input.invoiceNumber,
    issuedAt: instantStringSchema.make(
      temporalInstantToIsoString(input.issuedAt)
    ),
    fulfilledAt: instantStringSchema.make(
      temporalInstantToIsoString(input.fulfilledAt)
    ),
    paidAt: instantStringSchema.make(temporalInstantToIsoString(input.paidAt)),
  });
};
