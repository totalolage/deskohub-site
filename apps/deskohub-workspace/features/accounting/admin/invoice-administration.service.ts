import {
  type DotyposCustomer,
  type DotyposCustomerDetails,
  type DotyposCustomerId,
  DotyposCustomerIdSchema,
  DotyposService,
} from "@deskohub/dotypos";
import type {
  AdministrationInvoiceCreateInputType,
  AdministrationInvoiceCustomerDetailsType,
  AdministrationInvoiceIdType,
  AdministrationInvoicePaymentStatusType,
} from "@deskohub/workspace-admin-api";
import { AdministrationInvoiceId } from "@deskohub/workspace-admin-api";
import {
  BigDecimal,
  Context,
  Data,
  Effect,
  Layer,
  Match,
  Schema,
} from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  type InvoiceBuyer,
  type InvoiceDocument,
  invoiceBuyerSchema,
  isManualInvoiceDocument,
} from "@/features/accounting/invoice";
import { getInvoicePresentation } from "@/features/accounting/invoice-presentation";
import {
  invoiceEnabledCurrencyDefinitions,
  invoiceIdSchema,
  invoiceVariableSymbolSchema,
  isInvoiceCurrencyPayable,
  type ManualInvoiceProvenance,
  normalizeManualInvoiceLines,
} from "@/features/accounting/manual-invoice";
import { getAdministrationPagination } from "@/features/administration/listing";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import {
  defaultWorkspaceCurrency,
  findWorkspaceCurrencyDefinition,
} from "@/shared/money/currencies";
import { workspaceSiteConstants } from "@/shared/utils";
import { plainDateStringSchema } from "@/shared/utils/temporal";
import { AccountingDocumentSnapshotRepository } from "../backend/accounting-document-snapshot.repository";
import { AccountingSnapshotKeyService } from "../backend/accounting-snapshot-key.service";
import {
  type InvoiceDeliveryStatus,
  type InvoiceListItem,
  InvoiceRepository,
} from "../backend/invoice.repository";
import { InvoiceEmailDeliveryService } from "../backend/invoice-email-delivery.service";
import { renderInvoicePdf } from "../backend/invoice-pdf";
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

export type InvoiceAdministrationPage = {
  readonly items: readonly InvoiceAdministrationListItem[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly pageCount: number;
};

export type InvoiceAdministrationDelivery = Readonly<
  Record<"customer" | "internal", InvoiceDeliveryStatus>
>;

export type InvoiceAdministrationSource =
  | "reservation-request"
  | "post-order-link"
  | "admin-ui"
  | "dhw-cli"
  | "legacy";

export type InvoiceAdministrationListItem = {
  readonly id: AdministrationInvoiceIdType;
  readonly invoiceNumber: string;
  readonly issuedAt: string;
  readonly customerName: string;
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
  readonly variableSymbol: string | null;
  readonly lines: readonly {
    readonly description: string;
    readonly price: string;
  }[];
  readonly buyer: InvoiceBuyer;
  readonly pdfUrl: string;
};

export type InvoiceAdministrationCustomer = {
  readonly id: string;
  readonly displayName: string;
  readonly email: string | null;
  readonly details: AdministrationInvoiceCustomerDetailsType;
};

export type InvoiceAdministrationCreateResult = {
  readonly invoiceId: AdministrationInvoiceIdType;
  readonly invoiceNumber: string;
  readonly changed: boolean;
  readonly needsAttention: boolean;
};

export type InvoiceAdministrationRetryResult = {
  readonly invoiceId: AdministrationInvoiceIdType;
  readonly changed: boolean;
  readonly needsAttention: boolean;
};

export class InvoiceAdministrationNotFoundError extends Data.TaggedError(
  "InvoiceAdministrationNotFoundError"
)<{ readonly invoiceId: string }> {}

export class InvoiceAdministrationCustomerError extends Data.TaggedError(
  "InvoiceAdministrationCustomerError"
)<{ readonly message: string }> {}

export class InvoiceAdministrationInProgressError extends Data.TaggedError(
  "InvoiceAdministrationInProgressError"
)<{
  readonly invoiceId: AdministrationInvoiceIdType;
  readonly message: string;
}> {}

const makeInvoiceAdministrationService = Effect.gen(function* () {
  const invoices = yield* InvoiceRepository;
  const deliveries = yield* InvoiceEmailDeliveryService;
  const dotypos = yield* DotyposService;
  const creationRequests = yield* ManualInvoiceCreationRequests;

  const list = Effect.fn("InvoiceAdministrationService.list")(
    (query: InvoiceAdministrationListQuery = {}) =>
      invoices.list().pipe(
        Effect.map((items) => {
          const today = getPragueDate();
          return items.map((item) => toListItem(item, today));
        }),
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
    const all = yield* invoices.list();
    const listed = all.find(({ invoice }) => invoice.id === stored.id);
    if (!listed)
      return yield* new InvoiceAdministrationNotFoundError({ invoiceId });
    return toDetail(listed, getPragueDate());
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

  const create = Effect.fn("InvoiceAdministrationService.create")(function* (
    input: AdministrationInvoiceCreateInputType,
    provenance: ManualInvoiceProvenance
  ) {
    const currency = findWorkspaceCurrencyDefinition(input.currency);
    if (!currency || !isInvoiceCurrencyPayable(currency.code)) {
      return yield* new InvoiceAdministrationCustomerError({
        message: "No receiving account is configured for the invoice currency.",
      });
    }
    const buyer = yield* toBuyer(input.customer.details);
    yield* normalizeManualInvoiceLines({
      currency: currency.code,
      lines: input.lines,
    });
    const invoiceId = invoiceIdSchema.make(input.invoiceId);
    const claim = yield* creationRequests.claim({
      invoiceId,
      normalizedRequestJson: getManualInvoiceCreationRequestJson(
        input,
        provenance
      ),
    });
    if (claim.kind === "mismatch") {
      return yield* new InvoiceAdministrationCustomerError({
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
    const issueForCustomer = (dotyposCustomerId: DotyposCustomerId) =>
      invoices.issueManual({
        invoiceId,
        dotyposCustomerId,
        buyer,
        deliveryEmail: input.customer.details.email,
        locale: input.locale,
        serviceDate: plainDateStringSchema.make(input.serviceDate),
        dueDate: plainDateStringSchema.make(input.dueDate),
        currency: currency.code,
        ...(input.variableSymbol && {
          variableSymbol: invoiceVariableSymbolSchema.make(
            input.variableSymbol
          ),
        }),
        lines: input.lines,
        provenance,
      });
    const existing = yield* invoices.findById(input.invoiceId);
    if (claim.kind === "completed" && !existing) {
      return yield* new ManualInvoiceCreationRequestError({
        message: "The completed invoice creation request has no invoice.",
      });
    }
    const issuance = existing
      ? yield* issueForCustomer(
          input.customer.kind === "existing"
            ? yield* decodeDotyposCustomerId(input.customer.customerId)
            : DotyposCustomerIdSchema.make(existing.dotyposCustomerId)
        )
      : yield* resolveCustomer(dotypos, input.customer).pipe(
          Effect.flatMap((customer) => decodeDotyposCustomerId(customer.id)),
          Effect.flatMap(issueForCustomer)
        );
    if (claim.kind === "claimed") {
      yield* creationRequests.complete(invoiceId);
    }
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
    const detail = yield* get(issuance.invoice.id);
    return {
      invoiceId: AdministrationInvoiceId.make(issuance.invoice.id),
      invoiceNumber: issuance.invoice.invoiceNumber,
      changed: issuance.changed,
      needsAttention: detail.needsAttention,
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
    const detail = yield* get(id);
    return {
      invoiceId: AdministrationInvoiceId.make(id),
      changed: result.status === "delivered" && result.changed,
      needsAttention: detail.needsAttention,
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
      defaultCurrency: defaultWorkspaceCurrency.code,
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
            message: "The selected customer id is invalid.",
          })
      )
    );
    const customer = yield* dotypos.getCustomer(customerId);
    if (customer.deleted)
      return yield* new InvoiceAdministrationCustomerError({
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
              message: "Dotypos returned a customer without an id.",
            })
          )
    ),
    Match.tag("NotFound", () => dotypos.createCustomer(details)),
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
  return {
    id: customer.id,
    displayName:
      customer.companyName?.trim() ||
      personName ||
      customer.email?.trim() ||
      "Unnamed customer",
    email: customer.email?.trim() || null,
    details,
  };
};

const toListItem = (
  { invoice, delivery, needsAttention }: InvoiceListItem,
  today: string
): InvoiceAdministrationListItem => {
  const document = invoice.document;
  const manual = isManualInvoiceDocument(document);
  const money = manual
    ? { total: document.total, currency: document.currency }
    : {
        total: minorUnitsToDecimal(
          document.quote.payment.expectedPrice.value,
          document.quote.payment.expectedPrice.exponent
        ),
        currency: document.quote.payment.expectedPrice.currency,
      };
  return {
    id: AdministrationInvoiceId.make(invoice.id),
    invoiceNumber: invoice.invoiceNumber,
    issuedAt: invoice.issuedAt.toString(),
    customerName: document.buyer.legalName,
    ...money,
    paymentStatus: getInvoiceAdministrationPaymentStatus(document, today),
    source: manual
      ? document.provenance.source
      : (document.provenance?.source ?? "legacy"),
    actor: manual ? document.provenance.actor : null,
    delivery,
    needsAttention,
  };
};

const toDetail = (
  item: InvoiceListItem,
  today: string
): InvoiceAdministrationDetail => {
  const summary = toListItem(item, today);
  const document = item.invoice.document;
  if (isManualInvoiceDocument(document)) {
    return {
      ...summary,
      locale: document.locale,
      serviceDate: document.serviceDate,
      dueDate: document.dueDate,
      variableSymbol: document.variableSymbol,
      lines: document.lines,
      buyer: document.buyer,
      pdfUrl: `/admin/invoices/${item.invoice.id}/pdf`,
    };
  }
  const presentation = getInvoicePresentation(document);
  return {
    ...summary,
    locale: document.locale,
    serviceDate: document.fulfilledAt ?? null,
    dueDate: null,
    variableSymbol: null,
    lines: presentation.lines.map(({ description, amount }) => ({
      description,
      price: amount,
    })),
    buyer: document.buyer,
    pdfUrl: `/admin/invoices/${item.invoice.id}/pdf`,
  };
};

export const getInvoiceAdministrationPaymentStatus = (
  document: InvoiceDocument,
  today: string
): AdministrationInvoicePaymentStatusType => {
  if (!isManualInvoiceDocument(document)) return "paid";
  if (!BigDecimal.isPositive(BigDecimal.fromStringUnsafe(document.total)))
    return "issued";
  if (document.dueDate < today) return "overdue";
  return document.dueDate === today ? "due" : "issued";
};

const getPragueDate = () =>
  Temporal.Now.zonedDateTimeISO(workspaceSiteConstants.location.timeZone)
    .toPlainDate()
    .toString();

export const decodeInvoiceAdministrationId = (invoiceId: string) =>
  Schema.decodeUnknownEffect(invoiceIdSchema)(invoiceId).pipe(
    Effect.mapError(() => new InvoiceAdministrationNotFoundError({ invoiceId }))
  );

const minorUnitsToDecimal = (value: number, exponent: number) => {
  const sign = value < 0 ? "-" : "";
  const digits = Math.abs(value)
    .toString()
    .padStart(exponent + 1, "0");
  return exponent === 0
    ? `${sign}${digits}`
    : `${sign}${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`;
};

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
  const snapshots = AccountingDocumentSnapshotRepository.Default.pipe(
    Layer.provide(storage)
  );
  const invoices = InvoiceRepository.Default.pipe(
    Layer.provide(Layer.merge(storage, snapshots))
  );
  const creationRequests = ManualInvoiceCreationRequests.Default.pipe(
    Layer.provide(storage)
  );
  return Layer.mergeAll(
    invoices,
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
    dueDate: input.dueDate,
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
