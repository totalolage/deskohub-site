import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { BigDecimal, Data, Effect, Schema } from "effect";
import { locales } from "@/features/i18n";
import { reservationCustomerEmailSchema } from "@/features/reservation/reservation-contact";
import {
  findWorkspaceCurrencyDefinition,
  type WorkspaceCurrencyCode,
  workspaceCurrencyCodeSchema,
  workspaceCurrencyDefinitions,
} from "@/shared/money/currencies";
import {
  type WorkspacePaymentAccount,
  workspaceSiteConstants,
} from "@/shared/utils/site-constants";
import { plainDateStringSchema } from "@/shared/utils/temporal";
import { invoiceBuyerSchema } from "./billing-identity";

export const invoiceIdSchema = Schema.String.check(Schema.isUUID())
  .pipe(Schema.brand("InvoiceId"))
  .annotate({
    identifier: "InvoiceId",
    description:
      "Client-generated invoice id protected by database uniqueness.",
  });
export type InvoiceId = typeof invoiceIdSchema.Type;

export const invoiceVariableSymbolSchema = Schema.Trim.check(
  Schema.isPattern(/^\d{1,10}$/)
)
  .pipe(Schema.brand("InvoiceVariableSymbol"))
  .annotate({
    identifier: "InvoiceVariableSymbol",
    description: "Czech variable symbol: one through ten decimal digits.",
  });
export type InvoiceVariableSymbol = typeof invoiceVariableSymbolSchema.Type;

export const manualInvoiceProvenanceSchema = Schema.Struct({
  source: Schema.Literals(["admin-ui", "dhw-cli"]),
  actor: Schema.Trim.check(Schema.isNonEmpty(), Schema.isMaxLength(255)),
});
export type ManualInvoiceProvenance = typeof manualInvoiceProvenanceSchema.Type;

export const manualInvoiceLineInputSchema = Schema.Struct({
  description: Schema.Trim.check(Schema.isNonEmpty(), Schema.isMaxLength(1000)),
  price: Schema.Trim.check(Schema.isPattern(/^[+-]?\d+(?:\.\d+)?$/)),
});
export type ManualInvoiceLineInput = typeof manualInvoiceLineInputSchema.Type;

export const manualInvoicePaymentSchema = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("due"),
    date: plainDateStringSchema,
  }),
  Schema.Struct({
    status: Schema.Literal("paid"),
    date: plainDateStringSchema,
  }),
]);
export type ManualInvoicePayment = typeof manualInvoicePaymentSchema.Type;

export const manualInvoiceInputSchema = Schema.Struct({
  invoiceId: invoiceIdSchema,
  dotyposCustomerId: DotyposCustomerIdSchema,
  buyer: invoiceBuyerSchema,
  deliveryEmail: reservationCustomerEmailSchema,
  locale: Schema.Literals(locales),
  serviceDate: plainDateStringSchema,
  payment: manualInvoicePaymentSchema,
  currency: workspaceCurrencyCodeSchema,
  variableSymbol: Schema.optional(invoiceVariableSymbolSchema),
  lines: Schema.Array(manualInvoiceLineInputSchema).check(
    Schema.isMinLength(1)
  ),
  provenance: manualInvoiceProvenanceSchema,
});
export type ManualInvoiceInput = typeof manualInvoiceInputSchema.Type;

export const manualInvoiceLineSchema = Schema.Struct({
  description: Schema.NonEmptyString,
  price: Schema.String,
});
export type ManualInvoiceLine = typeof manualInvoiceLineSchema.Type;

export class ManualInvoiceValidationError extends Data.TaggedError(
  "ManualInvoiceValidationError"
)<{ readonly message: string }> {}

export interface NormalizedManualInvoiceInput
  extends Omit<ManualInvoiceInput, "lines"> {
  readonly lines: readonly ManualInvoiceLine[];
  readonly total: string;
}

export const normalizeManualInvoiceInput = Effect.fn(
  "normalizeManualInvoiceInput"
)(function* (input: ManualInvoiceInput) {
  const normalized = yield* normalizeManualInvoiceLines({
    currency: input.currency,
    lines: input.lines,
  });

  return {
    ...input,
    deliveryEmail: input.deliveryEmail.trim(),
    ...normalized,
  } satisfies NormalizedManualInvoiceInput;
});

export const normalizeManualInvoiceLines = Effect.fn(
  "normalizeManualInvoiceLines"
)(function* (input: {
  readonly currency: WorkspaceCurrencyCode;
  readonly lines: readonly ManualInvoiceLineInput[];
}) {
  const currency = findWorkspaceCurrencyDefinition(input.currency);
  if (!currency) {
    return yield* new ManualInvoiceValidationError({
      message: "Invoice currency is unsupported.",
    });
  }

  const amounts: BigDecimal.BigDecimal[] = [];
  const lines: ManualInvoiceLine[] = [];
  for (const line of input.lines) {
    const amount = BigDecimal.normalize(
      BigDecimal.fromStringUnsafe(line.price)
    );
    if (amount.scale > currency.exponent) {
      return yield* new ManualInvoiceValidationError({
        message: `${currency.code} prices support at most ${currency.exponent} decimal places.`,
      });
    }
    amounts.push(amount);
    lines.push({
      description: line.description.trim(),
      price: BigDecimal.format(amount),
    });
  }

  return {
    lines,
    total: BigDecimal.format(BigDecimal.sumAll(amounts)),
  };
});

const invoicePaymentAccounts: Partial<
  Readonly<Record<WorkspaceCurrencyCode, WorkspacePaymentAccount>>
> = workspaceSiteConstants.company.paymentAccounts;

export const findInvoicePaymentAccount = (currency: WorkspaceCurrencyCode) =>
  invoicePaymentAccounts[currency];

export const invoiceEnabledCurrencyDefinitions =
  workspaceCurrencyDefinitions.filter(({ code }) =>
    findInvoicePaymentAccount(code)
  );

export const isInvoiceCurrencyPayable = (currency: WorkspaceCurrencyCode) =>
  invoiceEnabledCurrencyDefinitions.some(({ code }) => code === currency);
