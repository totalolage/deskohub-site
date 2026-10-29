import {
  type DotyposCustomer,
  type DotyposCustomerDetails,
  type DotyposCustomerId,
  DotyposCustomerIdSchema,
  DotyposService,
} from "@deskohub/dotypos";
import type {
  AdministrationDotyposCustomerIdType,
  AdministrationInvoiceCreateInputType,
  AdministrationInvoiceCustomerDetailsType,
  AdministrationInvoiceIdType,
  AdministrationInvoicePaymentStatusType,
  AdministrationWorkspaceReservationIdType,
} from "@deskohub/workspace-admin-api";
import {
  AdministrationDotyposCustomerId,
  AdministrationInvoiceId,
  AdministrationWorkspaceReservationId,
} from "@deskohub/workspace-admin-api";
import {
  BigDecimal,
  Context,
  Data,
  Effect,
  Layer,
  Match,
  Option,
  Schema,
} from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { WorkspaceLocks } from "@/db/workspace-locks";
import {
  type InvoiceBuyer,
  invoiceBuyerSchema,
  invoiceNumberSchema,
  isManualInvoiceDocument,
  makeManualInvoiceDocument,
} from "@/features/accounting/invoice";
import type { InvoiceDeliveryStatus } from "@/features/accounting/invoice-email-delivery";
import { getInvoicePresentation } from "@/features/accounting/invoice-presentation";
import {
  getInvoicePaymentStatus,
  getInvoiceSettlement,
  getInvoiceTotal,
  type InvoiceSettlement,
} from "@/features/accounting/invoice-settlement";
import {
  type InvoiceId,
  invoiceEnabledCurrencyDefinitions,
  invoiceIdSchema,
  invoiceVariableSymbolSchema,
  isInvoiceCurrencyPayable,
  type ManualInvoiceIssuer,
  type ManualInvoiceProvenance,
  normalizeManualInvoiceInput,
  normalizeManualInvoiceLines,
  toManualInvoiceProvenance,
} from "@/features/accounting/manual-invoice";
import {
  type AdministrationHref,
  administrationHref,
} from "@/features/administration/administration-href";
import { unnamedCustomerDisplayName } from "@/features/administration/customer-name";
import { getAdministrationPagination } from "@/features/administration/listing";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import {
  defaultWorkspaceCurrencyCode,
  findWorkspaceCurrencyDefinition,
} from "@/shared/money/currencies";
import { workspaceSiteConstants } from "@/shared/utils";
import {
  type PlainDate,
  plainDateStringSchema,
  temporalInstantToPlainDate,
} from "@/shared/utils/temporal";
import { AccountingSnapshotKeyService } from "../backend/accounting-snapshot-key.service";
import { type Invoice, InvoiceRepository } from "../backend/invoice.repository";
import {
  type InvoiceDeliverySummary,
  InvoiceEmailDeliveryRepository,
} from "../backend/invoice-email-delivery.repository";
import { InvoiceEmailDeliveryService } from "../backend/invoice-email-delivery.service";
import { renderInvoicePdf } from "../backend/invoice-pdf";
import {
  decodeInvoiceAdministrationId,
  InvoiceAdministrationNotFoundError,
} from "./invoice-administration-identifier";
import {
  ManualInvoiceCreationRequestError,
  ManualInvoiceCreationRequests,
} from "./manual-invoice-creation-requests.service";

export type InvoiceAdministrationListQuery = {
  readonly sort?:
    | "invoiceNumber"
    | "issuedAt"
    | "customer"
    | "total"
    | "paymentStatus"
    | "source"
    | "delivery";
  readonly direction?: "asc" | "desc";
  readonly page?: number;
};

type InvoiceAdministrationPage = {
  readonly items: readonly InvoiceAdministrationListItem[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly pageCount: number;
};

type InvoiceAdministrationDelivery = Readonly<
  Record<"customer" | "internal", InvoiceDeliveryStatus>
>;

type InvoiceAdministrationSource =
  | "reservation-request"
  | "post-order-link"
  | "admin-ui"
  | "dhw-cli"
  | "assistant"
  | "legacy";

export type InvoiceAdministrationListItem = {
  readonly id: AdministrationInvoiceIdType;
  readonly invoiceNumber: string;
  readonly issuedAt: string;
  readonly customerId: AdministrationDotyposCustomerIdType;
  readonly customerName: string;
  readonly reservationId: AdministrationWorkspaceReservationIdType | null;
  readonly total: string;
  readonly currency: string;
  readonly paymentStatus: AdministrationInvoicePaymentStatusType;
  readonly source: InvoiceAdministrationSource;
  readonly actor: string | null;
  readonly delivery: InvoiceAdministrationDelivery;
  readonly needsAttention: boolean;
};

export type InvoiceAdministrationDetail = InvoiceAdministrationListItem & {
  readonly locale: "cs-CZ" | "en-US";
  readonly serviceDate: string | null;
  readonly dueDate: string | null;
  readonly paidOn: string | null;
  readonly variableSymbol: string | null;
  readonly lines: readonly {
    readonly description: string;
    readonly price: string;
  }[];
  readonly buyer: InvoiceBuyer;
  readonly pdfUrl: AdministrationHref;
  /** For the Admin UI; the administration API contract does not carry it. */
  readonly settlement: InvoiceSettlement;
};

export type InvoiceAdministrationCustomer = {
  readonly id: string;
  /** Never empty: "Unnamed customer" when `hasName` is false. */
  readonly displayName: string;
  /** Whether Dotypos holds a name or email, so the Admin UI can name an unnamed customer in the operator's language. */
  readonly hasName: boolean;
  readonly email: string | null;
  readonly details: AdministrationInvoiceCustomerDetailsType;
};

type InvoiceAdministrationCreateResult = {
  readonly invoiceId: AdministrationInvoiceIdType;
  readonly invoiceNumber: string;
  readonly changed: boolean;
  readonly needsAttention: boolean;
};

type InvoiceAdministrationRetryResult = {
  readonly invoiceId: AdministrationInvoiceIdType;
  readonly changed: boolean;
  readonly needsAttention: boolean;
};

export type InvoiceAdministrationCustomerErrorReason =
  | "billing-details-invalid"
  | "currency-not-payable"
  | "customer-deleted"
  | "customer-email-ambiguous"
  | "customer-id-invalid"
  | "customer-id-missing"
  | "invoice-id-reused";

class InvoiceAdministrationCustomerError extends Data.TaggedError(
  "InvoiceAdministrationCustomerError"
)<{
  readonly reason: InvoiceAdministrationCustomerErrorReason;
  readonly message: string;
}> {}

export class InvoiceAdministrationInProgressError extends Data.TaggedError(
  "InvoiceAdministrationInProgressError"
)<{
  readonly invoiceId: AdministrationInvoiceIdType;
  readonly message: string;
}> {}

const makeInvoiceAdministrationService = Effect.gen(function* () {
  const { transaction } = yield* WorkspaceDatabase;
  const invoices = yield* InvoiceRepository;
  const deliveries = yield* InvoiceEmailDeliveryService;
  const deliveryLedger = yield* InvoiceEmailDeliveryRepository;
  const dotypos = yield* DotyposService;
  const creationRequests = yield* ManualInvoiceCreationRequests;

  const prepare = Effect.fn("InvoiceAdministrationService.prepare")(function* (
    input: AdministrationInvoiceCreateInputType,
    issuer: ManualInvoiceIssuer
  ) {
    const provenance = toManualInvoiceProvenance(issuer);
    const currency = findWorkspaceCurrencyDefinition(input.currency);
    if (!currency || !isInvoiceCurrencyPayable(currency.code)) {
      return yield* new InvoiceAdministrationCustomerError({
        reason: "currency-not-payable",
        message: "No receiving account is configured for the invoice currency.",
      });
    }
    const buyer = yield* toBuyer(input.customer.details);
    yield* normalizeManualInvoiceLines({
      currency: currency.code,
      lines: input.lines,
    });
    const invoiceId = invoiceIdSchema.make(input.invoiceId);
    return {
      invoiceId,
      provenance,
      forCustomer: (dotyposCustomerId: DotyposCustomerId) => ({
        invoiceId,
        dotyposCustomerId,
        buyer,
        deliveryEmail: input.customer.details.email,
        locale: input.locale,
        serviceDate: plainDateStringSchema.make(input.serviceDate),
        payment: {
          ...input.payment,
          date: plainDateStringSchema.make(input.payment.date),
        },
        currency: currency.code,
        ...(input.variableSymbol && {
          variableSymbol: invoiceVariableSymbolSchema.make(
            input.variableSymbol
          ),
        }),
        lines: input.lines,
        provenance,
      }),
    };
  });

  const list = Effect.fn("InvoiceAdministrationService.list")(
    (query: InvoiceAdministrationListQuery = {}) =>
      invoices.list().pipe(
        Effect.flatMap((stored) =>
          deliveryLedger.status(stored.map(({ id }) => id)).pipe(
            Effect.map((statuses) => {
              const today = getPragueDate();
              return stored.map((invoice) =>
                toListItem(invoice, statuses.get(invoice.id)!, today)
              );
            })
          )
        ),
        Effect.map((items): InvoiceAdministrationPage => {
          const sorted = sortInvoiceAdministrationItems(items, query);
          const pageSize = 24;
          const pagination = getAdministrationPagination({
            pageSize,
            requestedPage: query.page,
            total: sorted.length,
          });
          return {
            items: sorted.slice(
              pagination.offset,
              pagination.offset + pageSize
            ),
            total: sorted.length,
            page: pagination.page,
            pageSize,
            pageCount: pagination.pageCount,
          };
        })
      )
  );

  const get = Effect.fn("InvoiceAdministrationService.get")(function* (
    invoiceId: string
  ) {
    const id = yield* decodeInvoiceAdministrationId(invoiceId);
    const stored = yield* invoices.findById(id);
    if (!stored)
      return yield* new InvoiceAdministrationNotFoundError({ invoiceId });
    const statuses = yield* deliveryLedger.status([stored.id]);
    return toDetail(stored, statuses.get(stored.id)!, getPragueDate());
  });

  const needsAttention = Effect.fn(
    "InvoiceAdministrationService.needsAttention"
  )(function* (invoiceId: InvoiceId) {
    const statuses = yield* deliveryLedger.status([invoiceId]);
    return statuses.get(invoiceId)!.needsAttention;
  });

  const getPdf = Effect.fn("InvoiceAdministrationService.getPdf")(function* (
    invoiceId: string
  ) {
    const id = yield* decodeInvoiceAdministrationId(invoiceId);
    const stored = yield* invoices.findById(id);
    if (!stored)
      return yield* new InvoiceAdministrationNotFoundError({ invoiceId });
    const bytes = yield* renderInvoicePdf(stored.document);
    return { bytes, fileName: `${stored.invoiceNumber}.pdf` };
  });

  const searchCustomers = Effect.fn(
    "InvoiceAdministrationService.searchCustomers"
  )(function* (query: string) {
    const matches = yield* dotypos.searchCustomers(query);
    return matches
      .flatMap((customer): InvoiceAdministrationCustomer[] => {
        const projection = toCustomer(customer);
        return projection && !customer.deleted ? [projection] : [];
      })
      .slice(0, 50);
  });

  const preview = Effect.fn("InvoiceAdministrationService.preview")(function* (
    input: AdministrationInvoiceCreateInputType,
    issuer: ManualInvoiceIssuer
  ) {
    const prepared = yield* prepare(input, issuer);
    const normalized = yield* normalizeManualInvoiceInput(
      prepared.forCustomer(DotyposCustomerIdSchema.make("preview"))
    );
    return yield* renderInvoicePdf(
      makeManualInvoiceDocument({
        normalized,
        invoiceNumber: invoiceNumberSchema.make("PREVIEW-0000000000"),
        issuedAt: Temporal.Now.instant(),
      })
    );
  });

  const create = Effect.fn("InvoiceAdministrationService.create")(function* (
    input: AdministrationInvoiceCreateInputType,
    issuer: ManualInvoiceIssuer
  ) {
    const prepared = yield* prepare(input, issuer);
    const { invoiceId, provenance } = prepared;
    const issueForCustomer = (dotyposCustomerId: DotyposCustomerId) =>
      invoices.issueManual({
        ...prepared.forCustomer(dotyposCustomerId),
        issuedBy: issuer.administrator,
      });
    const issuance = yield* transaction(
      WorkspaceLocks.manualInvoiceCreation(invoiceId).pipe(
        Effect.andThen(
          Effect.gen(function* () {
            const claim = yield* creationRequests.claim({
              invoiceId,
              normalizedRequestJson: getManualInvoiceCreationRequestJson(
                input,
                provenance
              ),
            });
            if (claim.kind === "mismatch") {
              return yield* new InvoiceAdministrationCustomerError({
                reason: "invoice-id-reused",
                message: "Invoice id was already used with different input.",
              });
            }
            if (claim.kind === "in-progress") {
              return yield* new InvoiceAdministrationInProgressError({
                invoiceId: input.invoiceId,
                message:
                  "This invoice is already being created. Try the same request again shortly.",
              });
            }
            const existing = yield* invoices.findById(input.invoiceId);
            if (claim.kind === "completed" && !existing) {
              return yield* new ManualInvoiceCreationRequestError({
                message:
                  "The completed invoice creation request has no invoice.",
              });
            }
            const customerResolution = resolveCustomer(dotypos, input.customer);
            const lockedIssuance = existing
              ? yield* issueForCustomer(
                  input.customer.kind === "existing"
                    ? yield* decodeDotyposCustomerId(input.customer.customerId)
                    : DotyposCustomerIdSchema.make(existing.dotyposCustomerId)
                )
              : yield* (
                  input.customer.kind === "new"
                    ? // ponytail: one global new-customer lock avoids putting email
                      // PII in SQL; shard by a keyed normalized-email digest if
                      // admin throughput matters.
                      transaction(
                        WorkspaceLocks.manualInvoiceNewCustomer().pipe(
                          Effect.andThen(customerResolution)
                        )
                      )
                    : customerResolution
                ).pipe(
                  Effect.flatMap((customer) =>
                    decodeDotyposCustomerId(customer.id)
                  ),
                  Effect.flatMap(issueForCustomer)
                );
            if (claim.kind === "claimed") {
              yield* creationRequests.complete(invoiceId);
            }
            return lockedIssuance;
          })
        )
      )
    );
    yield* deliveries
      .deliverByInvoiceId({ invoiceId: issuance.invoice.id })
      .pipe(
        Effect.catch((cause) =>
          Effect.logWarning("Invoice email delivery needs attention", {
            cause,
            invoiceId: issuance.invoice.id,
          })
        )
      );
    return {
      invoiceId: AdministrationInvoiceId.make(issuance.invoice.id),
      invoiceNumber: issuance.invoice.invoiceNumber,
      changed: issuance.changed,
      needsAttention: yield* needsAttention(issuance.invoice.id),
    } satisfies InvoiceAdministrationCreateResult;
  });

  const retry = Effect.fn("InvoiceAdministrationService.retry")(function* (
    invoiceId: string
  ) {
    const id = yield* decodeInvoiceAdministrationId(invoiceId);
    const stored = yield* invoices.findById(id);
    if (!stored)
      return yield* new InvoiceAdministrationNotFoundError({ invoiceId });
    const result = yield* deliveries.deliverByInvoiceId({ invoiceId: id });
    return {
      invoiceId: AdministrationInvoiceId.make(id),
      changed: result.status === "delivered" && result.changed,
      needsAttention: yield* needsAttention(stored.id),
    } satisfies InvoiceAdministrationRetryResult;
  });

  const getCreationDefaults = Effect.fn(
    "InvoiceAdministrationService.getCreationDefaults"
  )(function* () {
    const today = Temporal.Now.zonedDateTimeISO(
      workspaceSiteConstants.location.timeZone
    ).toPlainDate();
    return {
      currencies: invoiceEnabledCurrencyDefinitions,
      defaultCurrency: defaultWorkspaceCurrencyCode,
      defaultServiceDate: today.toString(),
      defaultDueDate: today.add({ days: 14 }).toString(),
      suggestedVariableSymbol: yield* invoices.getSuggestedVariableSymbol(),
    };
  });

  return {
    create,
    get,
    getCreationDefaults,
    getPdf,
    list,
    preview,
    retry,
    searchCustomers,
  };
});

export class InvoiceAdministrationService extends Context.Service<
  InvoiceAdministrationService,
  Effect.Success<typeof makeInvoiceAdministrationService>
>()("@deskohub-workspace/accounting/InvoiceAdministrationService") {
  static Default = Layer.effect(this, makeInvoiceAdministrationService);
  static Live = this.Default.pipe(Layer.provide(getDependencies()));
}

const decodeDotyposCustomerId = (customerId: string | undefined) =>
  Schema.decodeUnknownEffect(DotyposCustomerIdSchema)(customerId).pipe(
    Effect.mapError(
      () =>
        new InvoiceAdministrationCustomerError({
          reason: "customer-id-missing",
          message: "Dotypos returned a customer without an id.",
        })
    )
  );

const resolveCustomer = Effect.fn(
  "InvoiceAdministrationService.resolveCustomer"
)(function* (
  dotypos: Context.Service.Shape<typeof DotyposService>,
  input: AdministrationInvoiceCreateInputType["customer"]
) {
  const details = toDotyposDetails(input.details);
  if (input.kind === "existing") {
    const customerId = yield* Schema.decodeUnknownEffect(
      DotyposCustomerIdSchema
    )(input.customerId).pipe(
      Effect.mapError(
        () =>
          new InvoiceAdministrationCustomerError({
            reason: "customer-id-invalid",
            message: "The selected customer id is invalid.",
          })
      )
    );
    const customer = yield* dotypos.getCustomer(customerId);
    // A customer Dotypos no longer has gets the same answer as a soft-deleted
    // one.
    if (Option.isNone(customer) || customer.value.deleted)
      return yield* new InvoiceAdministrationCustomerError({
        reason: "customer-deleted",
        message: "The selected customer is deleted.",
      });
    return yield* dotypos.updateCustomerDetails(customerId, details);
  }

  const found = yield* dotypos.findCustomer(
    { firstName: details.firstName, email: details.email },
    { lookupFields: ["email"] }
  );
  return yield* Match.value(found).pipe(
    Match.tag("Ambiguous", () =>
      Effect.fail(
        new InvoiceAdministrationCustomerError({
          reason: "customer-email-ambiguous",
          message:
            "Multiple Dotypos customers use this email. Select the correct existing customer.",
        })
      )
    ),
    Match.tag("Matched", ({ customer }) =>
      customer.id
        ? dotypos.updateCustomerDetails(customer.id, details)
        : Effect.fail(
            new InvoiceAdministrationCustomerError({
              reason: "customer-id-missing",
              message: "Dotypos returned a customer without an id.",
            })
          )
    ),
    Match.tag("NotFound", () => dotypos.createCustomer(details)),
    // Deleted profiles were invisible to lookups before; keep creating a
    // fresh customer so this administrative flow stays compatible.
    Match.tag("Deleted", () => dotypos.createCustomer(details)),
    Match.exhaustive
  );
});

const toDotyposDetails = (
  details: AdministrationInvoiceCustomerDetailsType
): DotyposCustomerDetails => ({
  firstName: details.firstName ?? "",
  lastName: details.lastName ?? "",
  email: details.email,
  ...(details.phone && { phone: details.phone }),
  addressLine1: details.address.line1,
  addressLine2: details.address.line2 ?? "",
  city: details.address.city,
  zip: details.address.postalCode,
  country: details.address.country,
  companyName: details.kind === "business" ? details.companyName : "",
  companyId: details.kind === "business" ? details.companyId : "",
  vatId: details.kind === "business" ? (details.vatId ?? "") : "",
});

const toBuyer = Effect.fn("InvoiceAdministrationService.toBuyer")(
  (details: AdministrationInvoiceCustomerDetailsType) =>
    Schema.decodeUnknownEffect(invoiceBuyerSchema, {
      onExcessProperty: "error",
    })({
      kind: details.kind,
      legalName:
        details.kind === "business"
          ? details.companyName
          : `${details.firstName} ${details.lastName}`.trim(),
      ...(details.kind === "business" && {
        companyId: details.companyId,
        ...(details.vatId && { vatId: details.vatId }),
      }),
      address: details.address,
    }).pipe(
      Effect.mapError(
        () =>
          new InvoiceAdministrationCustomerError({
            reason: "billing-details-invalid",
            message: "Complete valid billing details are required.",
          })
      )
    )
);

const toCustomer = (
  customer: DotyposCustomer
): InvoiceAdministrationCustomer | null => {
  if (!customer.id) return null;
  const personName = [customer.firstName, customer.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();
  const common = {
    email: customer.email?.trim() ?? "",
    ...(customer.phone?.trim() && { phone: customer.phone.trim() }),
    firstName: customer.firstName?.trim() || undefined,
    lastName: customer.lastName?.trim() || undefined,
    address: {
      line1: customer.addressLine1?.trim() ?? "",
      ...(customer.addressLine2?.trim() && {
        line2: customer.addressLine2.trim(),
      }),
      city: customer.city?.trim() ?? "",
      postalCode: customer.zip?.trim() ?? "",
      country: customer.country?.trim().toUpperCase() || "CZ",
    },
  };
  const details = customer.companyName?.trim()
    ? {
        ...common,
        kind: "business" as const,
        companyName: customer.companyName.trim(),
        companyId: customer.companyId?.trim() ?? "",
        ...(customer.vatId?.trim() && { vatId: customer.vatId.trim() }),
      }
    : {
        ...common,
        kind: "person" as const,
        firstName: customer.firstName?.trim() ?? "",
        lastName: customer.lastName?.trim() ?? "",
      };
  const name =
    customer.companyName?.trim() || personName || customer.email?.trim();
  return {
    id: customer.id,
    displayName: name || unnamedCustomerDisplayName,
    hasName: Boolean(name),
    email: customer.email?.trim() || null,
    details,
  };
};

const toListItem = (
  invoice: Invoice,
  { customer, internal, needsAttention }: InvoiceDeliverySummary,
  today: PlainDate
): InvoiceAdministrationListItem => {
  const document = invoice.document;
  const manual = isManualInvoiceDocument(document);
  const total = getInvoiceTotal(document);
  return {
    id: AdministrationInvoiceId.make(invoice.id),
    invoiceNumber: invoice.invoiceNumber,
    issuedAt: invoice.issuedAt.toString(),
    customerId: AdministrationDotyposCustomerId.make(invoice.dotyposCustomerId),
    customerName: document.buyer.legalName,
    reservationId: invoice.workspaceReservationId
      ? AdministrationWorkspaceReservationId.make(
          invoice.workspaceReservationId
        )
      : null,
    total: total.amount,
    currency: total.currency,
    paymentStatus: getInvoicePaymentStatus(document, today),
    source: manual
      ? document.provenance.source
      : (document.provenance?.source ?? "legacy"),
    actor: manual ? document.provenance.actor : null,
    delivery: { customer, internal },
    needsAttention,
  };
};

const toDetail = (
  invoice: Invoice,
  delivery: InvoiceDeliverySummary,
  today: PlainDate
): InvoiceAdministrationDetail => {
  const summary = toListItem(invoice, delivery, today);
  const document = invoice.document;
  const settlement = getInvoiceSettlement(document);
  // The contract reports the due date a manual invoice states even when
  // nothing is due; the Admin UI shows it only when payment is requested.
  const terms = Match.value(settlement).pipe(
    Match.tagsExhaustive({
      Paid: ({ paidOn }) => ({ dueDate: null, paidOn }),
      PaymentRequested: ({ dueDate }) => ({ dueDate, paidOn: null }),
      NothingDue: ({ statedDueDate }) => ({
        dueDate: statedDueDate,
        paidOn: null,
      }),
    })
  );
  if (isManualInvoiceDocument(document)) {
    return {
      ...summary,
      locale: document.locale,
      serviceDate: document.serviceDate,
      ...terms,
      variableSymbol: document.variableSymbol,
      lines: document.lines,
      buyer: document.buyer,
      // The API keeps this unprefixed; the proxy opens it in the operator's language.
      pdfUrl: administrationHref("/[locale]/admin/invoices/[invoiceId]/pdf", {
        invoiceId: invoice.id,
      }),
      settlement,
    };
  }
  const presentation = getInvoicePresentation(document);
  return {
    ...summary,
    locale: document.locale,
    // The administration contract carries a calendar date; the service date
    // of a reservation invoice is the Prague date of its fulfillment instant.
    serviceDate: document.fulfilledAt
      ? temporalInstantToPlainDate({
          instant: Temporal.Instant.from(document.fulfilledAt),
          timeZone: workspaceSiteConstants.location.timeZone,
        }).toString()
      : null,
    ...terms,
    variableSymbol: null,
    lines: presentation.lines.map(({ description, amount }) => ({
      description,
      price: amount,
    })),
    buyer: document.buyer,
    // The API keeps this unprefixed; the proxy opens it in the operator's language.
    pdfUrl: administrationHref("/[locale]/admin/invoices/[invoiceId]/pdf", {
      invoiceId: invoice.id,
    }),
    settlement,
  };
};

const getPragueDate = () =>
  plainDateStringSchema.make(
    Temporal.Now.zonedDateTimeISO(workspaceSiteConstants.location.timeZone)
      .toPlainDate()
      .toString()
  );

export const sortInvoiceAdministrationItems = (
  items: readonly InvoiceAdministrationListItem[],
  query: InvoiceAdministrationListQuery
) => {
  const direction = query.direction === "asc" ? 1 : -1;
  return items.toSorted((left, right) => {
    if (!query.sort) {
      return (
        Number(right.needsAttention) - Number(left.needsAttention) ||
        right.issuedAt.localeCompare(left.issuedAt)
      );
    }
    const compared = {
      invoiceNumber: left.invoiceNumber.localeCompare(right.invoiceNumber),
      issuedAt: left.issuedAt.localeCompare(right.issuedAt),
      customer: left.customerName.localeCompare(right.customerName),
      total: BigDecimal.Order(
        BigDecimal.fromStringUnsafe(left.total),
        BigDecimal.fromStringUnsafe(right.total)
      ),
      paymentStatus: left.paymentStatus.localeCompare(right.paymentStatus),
      source: left.source.localeCompare(right.source),
      delivery: Number(left.needsAttention) - Number(right.needsAttention),
    }[query.sort];
    return compared * direction || left.id.localeCompare(right.id);
  });
};

function getDependencies() {
  const storage = Layer.merge(
    WorkspaceDatabase.Default,
    AccountingSnapshotKeyService.Default
  );
  const creationRequests = ManualInvoiceCreationRequests.Default.pipe(
    Layer.provide(storage)
  );
  return Layer.mergeAll(
    WorkspaceDatabase.Default,
    InvoiceRepository.Live,
    InvoiceEmailDeliveryRepository.Live,
    creationRequests,
    InvoiceEmailDeliveryService.Live,
    WorkspaceDotyposLayer
  );
}

export const getManualInvoiceCreationRequestJson = (
  input: AdministrationInvoiceCreateInputType,
  provenance: ManualInvoiceProvenance
) =>
  JSON.stringify({
    invoiceId: input.invoiceId,
    customer:
      input.customer.kind === "existing"
        ? {
            kind: input.customer.kind,
            customerId: input.customer.customerId.trim(),
            details: getNormalizedCustomerDetails(input.customer.details),
          }
        : {
            kind: input.customer.kind,
            details: getNormalizedCustomerDetails(input.customer.details),
          },
    locale: input.locale,
    serviceDate: input.serviceDate,
    ...(input.payment.status === "paid"
      ? { paidOn: input.payment.date }
      : { dueDate: input.payment.date }),
    currency: input.currency,
    variableSymbol: input.variableSymbol?.trim() ?? null,
    lines: input.lines.map((line) => ({
      description: line.description.trim(),
      price: BigDecimal.format(
        BigDecimal.normalize(BigDecimal.fromStringUnsafe(line.price))
      ),
    })),
    provenance: {
      source: provenance.source,
      actor: provenance.actor.trim(),
    },
  });

const getNormalizedCustomerDetails = (
  details: AdministrationInvoiceCustomerDetailsType
) => {
  const common = {
    email: details.email.trim(),
    phone: details.phone?.trim() ?? null,
    address: {
      line1: details.address.line1.trim(),
      line2: details.address.line2?.trim() ?? null,
      city: details.address.city.trim(),
      postalCode: details.address.postalCode.trim(),
      country: details.address.country.trim(),
    },
  };
  return details.kind === "business"
    ? {
        ...common,
        kind: details.kind,
        companyName: details.companyName.trim(),
        companyId: details.companyId.trim(),
        vatId: details.vatId?.trim() ?? null,
        firstName: details.firstName?.trim() ?? null,
        lastName: details.lastName?.trim() ?? null,
      }
    : {
        ...common,
        kind: details.kind,
        firstName: details.firstName.trim(),
        lastName: details.lastName.trim(),
      };
};
