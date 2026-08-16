import { Schema } from "effect";
import { orderIdSchema } from "@/features/order";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import {
  instantStringSchema,
  temporalInstantToIsoString,
} from "@/shared/utils/temporal";
import {
  type AccountingDocumentSnapshot,
  accountingDocumentIdentitySchema,
  coworkAccountingDocumentSnapshotSchema,
  goodsAccountingDocumentSnapshotSchema,
  meetingRoomAccountingDocumentSnapshotSchema,
  officeAccountingDocumentSnapshotSchema,
} from "./accounting-document-snapshot";
import type { InvoiceBuyer } from "./billing-identity";

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

const storedInvoiceBillingTextSchema = Schema.Trim.check(Schema.isNonEmpty());
const storedInvoiceBuyerAddressSchema = Schema.Struct({
  line1: storedInvoiceBillingTextSchema,
  line2: Schema.optionalKey(storedInvoiceBillingTextSchema),
  city: storedInvoiceBillingTextSchema,
  postalCode: storedInvoiceBillingTextSchema,
  country: storedInvoiceBillingTextSchema,
});
const storedInvoiceBuyerSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("person"),
    legalName: storedInvoiceBillingTextSchema,
    address: storedInvoiceBuyerAddressSchema,
  }),
  Schema.Struct({
    kind: Schema.Literal("business"),
    legalName: storedInvoiceBillingTextSchema,
    companyId: storedInvoiceBillingTextSchema.pipe(
      Schema.brand("CompanyRegistrationId")
    ),
    vatId: Schema.optionalKey(
      storedInvoiceBillingTextSchema.pipe(Schema.brand("VatRegistrationId"))
    ),
    address: storedInvoiceBuyerAddressSchema,
  }),
]);

const invoiceRecordSchema = Schema.Struct({
  dotyposCustomerId: accountingDocumentIdentitySchema.fields.dotyposCustomerId,
  locale: accountingDocumentIdentitySchema.fields.locale,
  buyer: storedInvoiceBuyerSchema,
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

const reservationInvoiceIdentitySchema = Schema.Struct({
  ...accountingDocumentIdentitySchema.fields,
  ...invoiceRecordSchema.fields,
});

const coworkInvoiceDocumentSchema = Schema.Struct({
  ...reservationInvoiceIdentitySchema.fields,
  reservation: coworkAccountingDocumentSnapshotSchema.fields.reservation,
  quote: coworkAccountingDocumentSnapshotSchema.fields.quote,
});

const meetingRoomInvoiceDocumentSchema = Schema.Struct({
  ...reservationInvoiceIdentitySchema.fields,
  reservation: meetingRoomAccountingDocumentSnapshotSchema.fields.reservation,
  quote: meetingRoomAccountingDocumentSnapshotSchema.fields.quote,
});

const officeInvoiceDocumentSchema = Schema.Struct({
  ...reservationInvoiceIdentitySchema.fields,
  reservation: officeAccountingDocumentSnapshotSchema.fields.reservation,
  quote: officeAccountingDocumentSnapshotSchema.fields.quote,
});

const goodsInvoiceDocumentSchema = Schema.Struct({
  ...invoiceRecordSchema.fields,
  orderId: goodsAccountingDocumentSnapshotSchema.fields.orderId,
  fulfilledAt: goodsAccountingDocumentSnapshotSchema.fields.fulfilledAt,
  lines: goodsAccountingDocumentSnapshotSchema.fields.lines,
  totals: goodsAccountingDocumentSnapshotSchema.fields.totals,
});

export const invoiceDocumentSchema = Schema.Union([
  coworkInvoiceDocumentSchema,
  meetingRoomInvoiceDocumentSchema,
  officeInvoiceDocumentSchema,
  goodsInvoiceDocumentSchema,
]).annotate({
  identifier: "InvoiceDocument",
  description:
    "Immutable facts of an issued invoice, independent of mutable customer data.",
});

export type InvoiceDocument = typeof invoiceDocumentSchema.Type;

export const getInvoiceOrderId = (document: InvoiceDocument) =>
  "orderId" in document
    ? document.orderId
    : orderIdSchema.make(document.workspaceReservationId);

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
  const issuedFacts = {
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
  };
  return "orderId" in input.source
    ? goodsInvoiceDocumentSchema.make({
        ...input.source,
        ...issuedFacts,
        fulfilledAt: input.source.fulfilledAt,
      })
    : invoiceDocumentSchema.make({
        ...input.source,
        ...issuedFacts,
        fulfilledAt: instantStringSchema.make(
          temporalInstantToIsoString(input.fulfilledAt)
        ),
      });
};
