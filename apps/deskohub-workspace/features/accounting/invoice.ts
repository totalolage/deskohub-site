import { Schema } from "effect";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import {
  instantStringSchema,
  temporalInstantToIsoString,
} from "@/shared/utils/temporal";
import {
  type AccountingBuyer,
  type AccountingDocumentSnapshot,
  accountingDocumentIdentitySchema,
  coworkAccountingDocumentSnapshotSchema,
  meetingRoomAccountingDocumentSnapshotSchema,
  officeAccountingDocumentSnapshotSchema,
} from "./accounting-document-snapshot";

export const invoiceNumberSchema = Schema.String.pipe(
  Schema.brand("InvoiceNumber")
).annotate({
  identifier: "InvoiceNumber",
  description: "Deskohub invoice number.",
});

export type InvoiceNumber = typeof invoiceNumberSchema.Type;

const invoiceIdentitySchema = Schema.Struct({
  ...accountingDocumentIdentitySchema.fields,
  paymentAttemptId: Schema.NonEmptyString,
  invoiceNumber: invoiceNumberSchema,
  issuedAt: instantStringSchema,
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
const decodeCurrentInvoiceDocument = Schema.decodeUnknownEffect(
  invoiceDocumentSchema,
  { onExcessProperty: "error" }
);

export const decodeInvoiceDocument = (encoded: unknown) =>
  decodeCurrentInvoiceDocument(removeLegacySchemaVersion(encoded));

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
  readonly buyer: AccountingBuyer;
  readonly paymentAttemptId: string;
  readonly invoiceNumber: InvoiceNumber;
  readonly issuedAt: Temporal.Instant;
}): InvoiceDocument => {
  const { schemaVersion: _sourceSchemaVersion, ...source } = input.source;

  return invoiceDocumentSchema.make({
    ...source,
    buyer: input.buyer,
    paymentAttemptId: input.paymentAttemptId,
    invoiceNumber: input.invoiceNumber,
    issuedAt: instantStringSchema.make(
      temporalInstantToIsoString(input.issuedAt)
    ),
  });
};

const removeLegacySchemaVersion = (encoded: unknown): unknown => {
  if (
    typeof encoded !== "object" ||
    encoded === null ||
    Array.isArray(encoded) ||
    !("schemaVersion" in encoded) ||
    encoded.schemaVersion !== 1
  ) {
    return encoded;
  }

  const { schemaVersion: _legacySchemaVersion, ...document } = encoded;
  return document;
};
