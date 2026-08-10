import { Schema } from "effect";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import {
  instantStringSchema,
  temporalInstantToIsoString,
} from "@/shared/utils/temporal";
import {
  type AccountingBuyer,
  type AccountingDocumentSnapshot,
  coworkAccountingDocumentSnapshotSchema,
  meetingRoomAccountingDocumentSnapshotSchema,
} from "./accounting-document-snapshot";

const maximumAnnualInvoiceSequence = 999_999;

export const invoiceNumberSchema = Schema.String.check(
  Schema.isPattern(/^WS-FV-\d{4}-\d{6}$/)
)
  .pipe(Schema.brand("InvoiceNumber"))
  .annotate({
    identifier: "InvoiceNumber",
    description: "Annual sequential Deskohub invoice number.",
  });

export type InvoiceNumber = typeof invoiceNumberSchema.Type;

const invoiceIdentitySchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  paymentAttemptId: Schema.NonEmptyString,
  invoiceNumber: invoiceNumberSchema,
  issuedAt: instantStringSchema,
});

const coworkInvoiceDocumentSchema = Schema.Struct({
  ...coworkAccountingDocumentSnapshotSchema.fields,
  ...invoiceIdentitySchema.fields,
});

const meetingRoomInvoiceDocumentSchema = Schema.Struct({
  ...meetingRoomAccountingDocumentSnapshotSchema.fields,
  ...invoiceIdentitySchema.fields,
});

export const invoiceDocumentSchema = Schema.Union([
  coworkInvoiceDocumentSchema,
  meetingRoomInvoiceDocumentSchema,
]).annotate({
  identifier: "InvoiceDocument",
  description:
    "Immutable facts of an issued invoice, independent of mutable customer data.",
});

export type InvoiceDocument = typeof invoiceDocumentSchema.Type;

const decodeInvoiceNumber = Schema.decodeUnknownSync(invoiceNumberSchema);

export const getInvoiceNumberingYear = (issuedAt: Temporal.Instant) =>
  issuedAt.toZonedDateTimeISO(workspaceSiteConstants.location.timeZone).year;

export const formatInvoiceNumber = (input: {
  readonly year: number;
  readonly sequence: number;
}): InvoiceNumber => {
  if (
    !Number.isInteger(input.year) ||
    input.year < 2000 ||
    input.year > 9999 ||
    !Number.isInteger(input.sequence) ||
    input.sequence < 1 ||
    input.sequence > maximumAnnualInvoiceSequence
  ) {
    throw new RangeError("Invoice number components are outside their range.");
  }

  return decodeInvoiceNumber(
    `WS-FV-${input.year}-${input.sequence.toString().padStart(6, "0")}`
  );
};

export const makeInvoiceDocument = (input: {
  readonly source: AccountingDocumentSnapshot;
  readonly buyer: AccountingBuyer;
  readonly paymentAttemptId: string;
  readonly invoiceNumber: InvoiceNumber;
  readonly issuedAt: Temporal.Instant;
}): InvoiceDocument =>
  invoiceDocumentSchema.make({
    ...input.source,
    schemaVersion: 1,
    buyer: input.buyer,
    paymentAttemptId: input.paymentAttemptId,
    invoiceNumber: input.invoiceNumber,
    issuedAt: instantStringSchema.make(
      temporalInstantToIsoString(input.issuedAt)
    ),
  });
