import {
  type DotyposCustomer,
  type DotyposCustomerDetails,
  type DotyposCustomerId,
  DotyposCustomerIdSchema,
  DotyposService,
} from "@deskohub/dotypos";
import { parsePhoneNumber } from "@deskohub/phone-number";
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
import { baseLocale, defaultPhoneRegion, type Locale } from "@/features/i18n";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import {
  defaultWorkspaceCurrencyCode,
  findWorkspaceCurrencyDefinition,
} from "@/shared/money/currencies";
import { workspaceSiteConstants } from "@/shared/utils";
import {
  currentPlainDate,
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
import { renderInvoicePdf, renderInvoicePdfFile } from "../backend/invoice-pdf";
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
  readonly locale: Locale;
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

type ManualInvoiceCreationClaim = Effect.Success<
  ReturnType<ManualInvoiceCreationRequests["Service"]["claim"]>
>;

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
          Effect.all([
            deliveryLedger.status(stored.map(({ id }) => id)),
            currentPragueDate,
          ]).pipe(
            Effect.map(([statuses, today]) =>
              stored.map((invoice) =>
                toListItem(invoice, statuses.get(invoice.id)!, today)
              )
            )
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
    return toDetail(stored, statuses.get(stored.id)!, yield* currentPragueDate);
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
    return yield* renderInvoicePdfFile(stored.document);
  });

  const searchCustomers = Effect.fn(
    "InvoiceAdministrationService.searchCustomers"
  )(function* (query: string) {
    const matches = yield* dotypos.searchCustomers(query);
    return matches
      .filter((customer) => !customer.deleted)
      .map(toCustomer)
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
    // The claim decides whether this request may issue: different input or
    // an unfinished concurrent creation refuses it, and a completed one must
    // still have its invoice.
    const findClaimedInvoice = Effect.fnUntraced(function* (
      claim: ManualInvoiceCreationClaim
    ) {
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
          message: "The completed invoice creation request has no invoice.",
        });
      }
      return existing;
    });
    // An invoice issued before keeps its customer unless the request names
    // one; otherwise the request's customer is resolved first.
    const issueLocked = Effect.fnUntraced(function* (existing: Invoice | null) {
      if (existing) {
        return yield* issueForCustomer(
          input.customer.kind === "existing"
            ? yield* decodeDotyposCustomerId(input.customer.customerId)
            : DotyposCustomerIdSchema.make(existing.dotyposCustomerId)
        );
      }
      const customerResolution = resolveCustomer(dotypos, input.customer);
      return yield* (
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
        Effect.flatMap((customer) => decodeDotyposCustomerId(customer.id)),
        Effect.flatMap(issueForCustomer)
      );
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
            const lockedIssuance = yield* issueLocked(
              yield* findClaimedInvoice(claim)
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
      dotypos.updateCustomerDetails(customer.id, details)
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
  // Not a visitor's input: the phone is the Dotypos customer's stored one or
  // what an administrator enters for the business's own customer, so a number
  // without a country calling code is a national one of the business's
  // market, the base locale's region, whatever the Admin's language.
  phone: Option.getOrUndefined(
    parsePhoneNumber(details.phone ?? "", defaultPhoneRegion(baseLocale))
  ),
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

/** A Dotypos text field without surrounding whitespace; absent reads as "". */
const customerText = (value: string | null | undefined) => value?.trim() ?? "";

const toCustomerAddress = (customer: DotyposCustomer) => {
  const line2 = customerText(customer.addressLine2);
  return {
    line1: customerText(customer.addressLine1),
    ...(line2 && { line2 }),
    city: customerText(customer.city),
    postalCode: customerText(customer.zip),
    country: customerText(customer.country).toUpperCase() || "CZ",
  };
};

/**
 * The billing details a Dotypos customer prefills: a business when it has a
 * company name, otherwise a person.
 */
const toCustomerDetails = (
  customer: DotyposCustomer
): AdministrationInvoiceCustomerDetailsType => {
  const phone = customerText(customer.phone);
  const common = {
    email: customerText(customer.email),
    ...(phone && { phone }),
    firstName: customerText(customer.firstName) || undefined,
    lastName: customerText(customer.lastName) || undefined,
    address: toCustomerAddress(customer),
  };
  const companyName = customerText(customer.companyName);
  if (!companyName) {
    return {
      ...common,
      kind: "person",
      firstName: customerText(customer.firstName),
      lastName: customerText(customer.lastName),
    };
  }
  const vatId = customerText(customer.vatId);
  return {
    ...common,
    kind: "business",
    companyName,
    companyId: customerText(customer.companyId),
    ...(vatId && { vatId }),
  };
};

const toCustomer = (
  customer: DotyposCustomer
): InvoiceAdministrationCustomer => {
  const personName = [customer.firstName, customer.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();
  const email = customerText(customer.email);
  const name = customerText(customer.companyName) || personName || email;
  return {
    id: customer.id,
    displayName: name || unnamedCustomerDisplayName,
    hasName: Boolean(name),
    email: email || null,
    details: toCustomerDetails(customer),
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

const currentPragueDate = currentPlainDate(
  workspaceSiteConstants.location.timeZone
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
