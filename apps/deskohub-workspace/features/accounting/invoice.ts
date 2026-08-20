import { Schema } from "effect";
import type { Locale } from "@/features/i18n";
import { workspaceCurrencyCodeSchema } from "@/shared/money/currencies";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import {
  instantStringSchema,
  type PlainDate,
  plainDateStringSchema,
  temporalInstantToIsoString,
} from "@/shared/utils/temporal";
import {
  type AccountingDocumentSnapshot,
  accountingDocumentIdentitySchema,
  coworkAccountingDocumentSnapshotSchema,
  meetingRoomAccountingDocumentSnapshotSchema,
  officeAccountingDocumentSnapshotSchema,
  workspaceAccountingSupplier,
} from "./accounting-document-snapshot";
import type { InvoiceBuyer } from "./billing-identity";
import {
  type InvoiceVariableSymbol,
  invoiceIdSchema,
  invoiceVariableSymbolSchema,
  type ManualInvoicePayment,
  manualInvoiceLineSchema,
  manualInvoiceProvenanceSchema,
  type NormalizedManualInvoiceInput,
} from "./manual-invoice";

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

const invoiceGenerationProvenanceSchema = Schema.Struct({
  system: Schema.Literal("deskohub-workspace"),
  generatedAt: instantStringSchema,
});

const invoiceIdentitySchema = Schema.Struct({
  ...accountingDocumentIdentitySchema.fields,
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
  provenance: Schema.optionalKey(
    Schema.Struct({
      ...invoiceGenerationProvenanceSchema.fields,
      source: Schema.Literals(["reservation-request", "post-order-link"]),
    })
  ),
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

const manualInvoiceDocumentIdentitySchema = Schema.Struct({
  documentKind: Schema.Literal("manual"),
  invoiceId: invoiceIdSchema,
  dotyposCustomerId: accountingDocumentIdentitySchema.fields.dotyposCustomerId,
  locale: accountingDocumentIdentitySchema.fields.locale,
  supplier: invoiceIdentitySchema.fields.supplier,
  buyer: storedInvoiceBuyerSchema,
  delivery: Schema.Struct({ email: Schema.NonEmptyString }),
  invoiceNumber: invoiceNumberSchema,
  issuedAt: instantStringSchema,
  serviceDate: plainDateStringSchema,
  currency: workspaceCurrencyCodeSchema,
  variableSymbol: invoiceVariableSymbolSchema,
  lines: Schema.Array(manualInvoiceLineSchema).check(Schema.isMinLength(1)),
  total: Schema.String,
  provenance: Schema.Struct({
    ...manualInvoiceProvenanceSchema.fields,
    ...invoiceGenerationProvenanceSchema.fields,
  }),
});

export const manualInvoiceDocumentSchema = Schema.Union([
  Schema.Struct({
    ...manualInvoiceDocumentIdentitySchema.fields,
    payment: Schema.Struct({
      status: Schema.Literal("paid"),
      date: plainDateStringSchema,
    }),
  }),
  Schema.Struct({
    ...manualInvoiceDocumentIdentitySchema.fields,
    dueDate: plainDateStringSchema,
  }),
]);
export type ManualInvoiceDocument = typeof manualInvoiceDocumentSchema.Type;

export const invoiceDocumentSchema = Schema.Union([
  coworkInvoiceDocumentSchema,
  meetingRoomInvoiceDocumentSchema,
  officeInvoiceDocumentSchema,
  manualInvoiceDocumentSchema,
]).annotate({
  identifier: "InvoiceDocument",
  description:
    "Immutable facts of an issued invoice, independent of mutable customer data.",
});

export type InvoiceDocument = typeof invoiceDocumentSchema.Type;

export const isManualInvoiceDocument = (
  document: InvoiceDocument
): document is ManualInvoiceDocument => "documentKind" in document;

export const getManualInvoicePayment = (
  document: ManualInvoiceDocument
): ManualInvoicePayment =>
  "payment" in document
    ? document.payment
    : { status: "due", date: document.dueDate };

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
  readonly provenance?: {
    readonly source: "reservation-request" | "post-order-link";
  };
}): InvoiceDocument => {
  const generatedAt = instantStringSchema.make(
    temporalInstantToIsoString(input.issuedAt)
  );
  return invoiceDocumentSchema.make({
    ...input.source,
    supplier: {
      ...input.source.supplier,
      commercialRegister: workspaceSiteConstants.company.commercialRegister,
    },
    buyer: input.buyer,
    paymentAttemptId: input.paymentAttemptId,
    invoiceNumber: input.invoiceNumber,
    issuedAt: generatedAt,
    fulfilledAt: instantStringSchema.make(
      temporalInstantToIsoString(input.fulfilledAt)
    ),
    paidAt: instantStringSchema.make(temporalInstantToIsoString(input.paidAt)),
    provenance: {
      ...getInvoiceGenerationProvenance(generatedAt),
      ...(input.provenance ?? { source: "reservation-request" }),
    },
  });
};

export const getInvoiceVariableSymbol = (
  invoiceNumber: InvoiceNumber
): InvoiceVariableSymbol =>
  invoiceVariableSymbolSchema.make(invoiceNumber.replace(/\D/g, "").slice(-10));

export const makeManualInvoiceDocument = (input: {
  readonly normalized: NormalizedManualInvoiceInput;
  readonly invoiceNumber: InvoiceNumber;
  readonly issuedAt: Temporal.Instant;
}): ManualInvoiceDocument => {
  const { normalized } = input;
  const generatedAt = instantStringSchema.make(
    temporalInstantToIsoString(input.issuedAt)
  );
  return manualInvoiceDocumentSchema.make({
    documentKind: "manual",
    invoiceId: normalized.invoiceId,
    dotyposCustomerId: normalized.dotyposCustomerId,
    locale: normalized.locale as Locale,
    supplier: {
      ...workspaceAccountingSupplier,
      commercialRegister: workspaceSiteConstants.company.commercialRegister,
    },
    buyer: normalized.buyer,
    delivery: { email: normalized.deliveryEmail },
    invoiceNumber: input.invoiceNumber,
    issuedAt: generatedAt,
    serviceDate: normalized.serviceDate as PlainDate,
    ...(normalized.payment.status === "paid"
      ? { payment: normalized.payment }
      : { dueDate: normalized.payment.date as PlainDate }),
    currency: normalized.currency,
    variableSymbol:
      normalized.variableSymbol ??
      getInvoiceVariableSymbol(input.invoiceNumber),
    lines: normalized.lines,
    total: normalized.total,
    provenance: {
      ...normalized.provenance,
      ...getInvoiceGenerationProvenance(generatedAt),
    },
  });
};

const getInvoiceGenerationProvenance = (
  generatedAt: typeof instantStringSchema.Type
) => ({ system: "deskohub-workspace" as const, generatedAt });
