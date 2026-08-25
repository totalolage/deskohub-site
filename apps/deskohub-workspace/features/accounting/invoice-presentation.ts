import { BigDecimal, Match } from "effect";
import {
  getInvoiceOrderId,
  getManualInvoicePayment,
  type InvoiceDocument,
  isManualInvoiceDocument,
  type ManualInvoiceDocument,
} from "@/features/accounting/invoice";
import { getWorkspaceProductTierTitle } from "@/features/checkout/product-catalog.i18n";
import { formatWorkspaceMoney } from "@/features/checkout/workspace-money";
import { type Locale, m } from "@/features/i18n";
import { findWorkspaceCurrencyDefinition } from "@/shared/money/currencies";
import { formatInstantDate } from "@/shared/utils/date-time-format";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";

export interface InvoicePresentationParty {
  readonly heading: string;
  readonly name: string;
  readonly details: readonly string[];
}

export interface InvoicePresentationLine {
  readonly description: string;
  readonly amount: string;
  readonly kind: "discount" | "item";
}

interface InvoicePresentationFact {
  readonly label: string;
  readonly value: string;
}

export interface InvoicePresentation {
  readonly locale: Locale;
  readonly title: string;
  readonly invoiceNumber: string;
  readonly status: string;
  readonly factColumns: readonly [
    readonly [InvoicePresentationFact, InvoicePresentationFact | null],
    readonly [
      InvoicePresentationFact,
      InvoicePresentationFact | null,
      InvoicePresentationFact | null,
    ],
  ];
  readonly supplier: InvoicePresentationParty;
  readonly buyer: InvoicePresentationParty;
  readonly lineDescriptionHeading: string;
  readonly lineAmountHeading: string;
  readonly lines: readonly InvoicePresentationLine[];
  readonly totalLabel: string;
  readonly total: string;
  readonly nonVatStatement: string;
  readonly footer: string;
}

type InvoiceCopy = {
  readonly title: string;
  readonly paid: string;
  readonly invoiceNumber: string;
  readonly issueDate: string;
  readonly paymentDate: string;
  readonly serviceDate: string;
  readonly reservationReference: string;
  readonly supplier: string;
  readonly buyer: string;
  readonly companyId: string;
  readonly vatId: string;
  readonly commercialRegister: string;
  readonly description: string;
  readonly amount: string;
  readonly totalPaid: string;
  readonly nonVatPayer: string;
  readonly coworkProducts: Readonly<Record<"basic" | "plus" | "profi", string>>;
  readonly coffee: string;
  readonly meetingRoom: string;
  readonly office: string;
  readonly discount: string;
  readonly hour: (count: number) => string;
  readonly day: (count: number) => string;
  readonly seat: (count: number) => string;
};

const getInvoiceCopy = (locale: Locale): InvoiceCopy => ({
  title: m.invoiceTitle({}, { locale }),
  paid: m.invoicePaidStatus({}, { locale }),
  invoiceNumber: m.invoiceNumberLabel({}, { locale }),
  issueDate: m.invoiceIssueDateLabel({}, { locale }),
  paymentDate: m.invoicePaymentDateLabel({}, { locale }),
  serviceDate: m.invoiceServiceDateLabel({}, { locale }),
  reservationReference: m.invoiceReservationReferenceLabel({}, { locale }),
  supplier: m.invoiceSupplierLabel({}, { locale }),
  buyer: m.invoiceBuyerLabel({}, { locale }),
  companyId: m.invoiceCompanyIdLabel({}, { locale }),
  vatId: m.invoiceVatIdLabel({}, { locale }),
  commercialRegister: m.invoiceCommercialRegisterLabel({}, { locale }),
  description: m.invoiceDescriptionLabel({}, { locale }),
  amount: m.invoiceAmountLabel({}, { locale }),
  totalPaid: m.invoiceTotalPaidLabel({}, { locale }),
  nonVatPayer: m.invoiceNonVatPayerStatement({}, { locale }),
  coworkProducts: {
    basic: getWorkspaceProductTierTitle("basic", locale),
    plus: getWorkspaceProductTierTitle("plus", locale),
    profi: getWorkspaceProductTierTitle("profi", locale),
  },
  coffee: m.invoiceCoffeeLineLabel({}, { locale }),
  meetingRoom: m.invoiceMeetingRoomLineLabel({}, { locale }),
  office: m.invoiceOfficeLineLabel({}, { locale }),
  discount: m.invoiceDiscountLabel({}, { locale }),
  hour: (count) => m.reservationMeetingRoomDurationHours({ count }, { locale }),
  day: (count) =>
    m.checkoutSummaryItemOfficeDayCount({ dayCount: count }, { locale }),
  seat: (count) => m.reservationOfficeSeatCountOption({ count }, { locale }),
});

export const getInvoicePresentation = (
  document: InvoiceDocument
): InvoicePresentation => {
  if (isManualInvoiceDocument(document)) {
    return getManualInvoicePresentation(document);
  }

  const { locale } = document;
  const copy = getInvoiceCopy(locale);

  return {
    locale,
    title: copy.title,
    invoiceNumber: document.invoiceNumber,
    status: copy.paid,
    factColumns: [
      [
        { label: copy.invoiceNumber, value: document.invoiceNumber },
        {
          label: copy.reservationReference,
          value: getInvoiceOrderId(document),
        },
      ],
      [
        {
          label: copy.issueDate,
          value: formatWorkspaceInstantDate(document.issuedAt, locale),
        },
        document.fulfilledAt
          ? {
              label: copy.serviceDate,
              value: formatWorkspaceInstantDate(document.fulfilledAt, locale),
            }
          : null,
        document.paidAt
          ? {
              label: copy.paymentDate,
              value: formatWorkspaceInstantDate(document.paidAt, locale),
            }
          : null,
      ],
    ],
    supplier: getSupplierPresentation(document, copy),
    buyer: getBuyerPresentation(document, copy),
    lineDescriptionHeading: copy.description,
    lineAmountHeading: copy.amount,
    lines: [
      ...getItemLines(document, copy),
      ...getDiscountLines(document, copy),
    ],
    totalLabel: copy.totalPaid,
    total: formatWorkspaceMoney(getInvoiceTotal(document), locale),
    nonVatStatement: copy.nonVatPayer,
    footer: `${document.supplier.legalName} · ${document.supplier.contactEmail}`,
  };
};

const getManualInvoicePresentation = (
  document: ManualInvoiceDocument
): InvoicePresentation => {
  const copy = getInvoiceCopy(document.locale);
  const payment = getManualInvoicePayment(document);
  const positiveTotal = BigDecimal.isPositive(
    BigDecimal.fromStringUnsafe(document.total)
  );
  const paymentRequested = payment.status === "due" && positiveTotal;
  const manual =
    document.locale === "cs-CZ"
      ? {
          issued: "Vystaveno",
          unpaid: "K úhradě",
          dueDate: "Datum splatnosti",
          variableSymbol: "Variabilní symbol",
          total: "Celkem",
          totalDue: "Celkem k úhradě",
        }
      : {
          issued: "Issued",
          unpaid: "Payment due",
          dueDate: "Due date",
          variableSymbol: "Variable symbol",
          total: "Total",
          totalDue: "Amount due",
        };
  const paymentPresentation = Match.value(payment).pipe(
    Match.discriminatorsExhaustive("status")({
      paid: ({ date }) => ({
        status: copy.paid,
        totalLabel: copy.totalPaid,
        dateFact: {
          label: copy.paymentDate,
          value: formatPlainDate(date, document.locale),
        },
      }),
      due: ({ date }) =>
        paymentRequested
          ? {
              status: manual.unpaid,
              totalLabel: manual.totalDue,
              dateFact: {
                label: manual.dueDate,
                value: formatPlainDate(date, document.locale),
              },
            }
          : {
              status: manual.issued,
              totalLabel: manual.total,
              dateFact: null,
            },
    })
  );

  return {
    locale: document.locale,
    title: copy.title,
    invoiceNumber: document.invoiceNumber,
    factColumns: [
      [
        { label: copy.invoiceNumber, value: document.invoiceNumber },
        positiveTotal
          ? { label: manual.variableSymbol, value: document.variableSymbol }
          : null,
      ],
      [
        {
          label: copy.issueDate,
          value: formatWorkspaceInstantDate(document.issuedAt, document.locale),
        },
        {
          label: copy.serviceDate,
          value: formatPlainDate(document.serviceDate, document.locale),
        },
        paymentPresentation.dateFact,
      ],
    ],
    supplier: getSupplierPresentation(document, copy),
    buyer: getBuyerPresentation(document, copy),
    lineDescriptionHeading: copy.description,
    lineAmountHeading: copy.amount,
    lines: document.lines.map((line) => ({
      kind: "item" as const,
      description: line.description,
      amount: formatManualMoney(line.price, document.currency),
    })),
    status: paymentPresentation.status,
    totalLabel: paymentPresentation.totalLabel,
    total: formatManualMoney(document.total, document.currency),
    nonVatStatement: copy.nonVatPayer,
    footer: `${document.supplier.legalName} · ${document.supplier.contactEmail}`,
  };
};

const getBuyerPresentation = (
  document: InvoiceDocument,
  copy: InvoiceCopy
): InvoicePresentationParty => {
  const { buyer, locale } = document;
  const address = buyer.address;
  const details = [
    address.line1,
    address.line2,
    `${address.postalCode} ${address.city}`,
    formatCountry(address.country, locale),
  ].filter((line): line is string => Boolean(line));

  if (buyer.kind === "business") {
    details.push(`${copy.companyId}: ${buyer.companyId}`);
    if (buyer.vatId) details.push(`${copy.vatId}: ${buyer.vatId}`);
  }

  return {
    heading: copy.buyer,
    name: buyer.legalName,
    details,
  };
};

const getSupplierPresentation = (
  document: InvoiceDocument,
  copy: InvoiceCopy
): InvoicePresentationParty => ({
  heading: copy.supplier,
  name: document.supplier.legalName,
  details: [
    document.supplier.address.street,
    document.supplier.address.cityDistrict,
    `${document.supplier.address.postalCode} ${document.supplier.address.city}`,
    formatCountry(document.supplier.address.country, document.locale),
    `${copy.companyId}: ${document.supplier.companyId}`,
    ...(document.supplier.commercialRegister
      ? [
          `${copy.commercialRegister}: ${document.supplier.commercialRegister.section} ${document.supplier.commercialRegister.file}, ${document.supplier.commercialRegister.court}`,
        ]
      : []),
    document.supplier.contactEmail,
  ],
});

const getItemLines = (
  document: Exclude<InvoiceDocument, ManualInvoiceDocument>,
  copy: InvoiceCopy
): readonly InvoicePresentationLine[] => {
  if ("orderId" in document) {
    return document.lines.map(
      ({ description, quantity, undiscountedTotal }) => ({
        kind: "item",
        description: `${description} × ${quantity}`,
        amount: formatWorkspaceMoney(undiscountedTotal, document.locale),
      })
    );
  }
  return document.quote.items.map(
    (item): InvoicePresentationLine =>
      Match.value(item).pipe(
        Match.discriminatorsExhaustive("type")({
          cowork: ({ amount, tier }) => ({
            kind: "item" as const,
            description: copy.coworkProducts[tier],
            amount: formatWorkspaceMoney(amount, document.locale),
          }),
          coffee: ({ amount }) => ({
            kind: "item" as const,
            description: copy.coffee,
            amount: formatWorkspaceMoney(amount, document.locale),
          }),
          "meeting-room": ({ amount, duration }) => {
            const durationLabel =
              duration.unit === "day"
                ? copy.day(duration.amount)
                : copy.hour(duration.amount);
            return {
              kind: "item" as const,
              description: `${copy.meetingRoom} · ${durationLabel}`,
              amount: formatWorkspaceMoney(amount, document.locale),
            };
          },
          office: ({ amount, dayCount, seats }) => ({
            kind: "item" as const,
            description: `${copy.office} · ${copy.day(dayCount)} · ${copy.seat(seats)}`,
            amount: formatWorkspaceMoney(amount, document.locale),
          }),
        })
      )
  );
};

const getDiscountLines = (
  document: Exclude<InvoiceDocument, ManualInvoiceDocument>,
  copy: InvoiceCopy
): readonly InvoicePresentationLine[] => {
  const discounts =
    "orderId" in document
      ? document.lines.flatMap(({ discounts }) => discounts)
      : document.quote.payment.discounts;
  return discounts.map(({ amount, discount }) => ({
    kind: "discount",
    description: `${copy.discount}: ${discount.label}`,
    amount: `−${formatWorkspaceMoney(amount, document.locale)}`,
  }));
};

const getInvoiceTotal = (
  document: Exclude<InvoiceDocument, ManualInvoiceDocument>
) =>
  "orderId" in document
    ? document.totals.payable
    : document.quote.payment.expectedPrice;

const formatWorkspaceInstantDate = (value: string, locale: Locale) =>
  formatInstantDate({
    instant: Temporal.Instant.from(value),
    locale,
    timeZone: workspaceSiteConstants.location.timeZone,
  });

const formatCountry = (country: string, locale: Locale) => {
  try {
    return (
      new Intl.DisplayNames([locale], { type: "region" }).of(country) ?? country
    );
  } catch {
    return country;
  }
};

const formatPlainDate = (value: string, locale: Locale) =>
  new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));

const formatManualMoney = (value: string, currency: string) => {
  const exponent = findWorkspaceCurrencyDefinition(currency)?.exponent ?? 0;
  const [integer, fraction = ""] = value.split(".");
  return `${integer}${exponent > 0 ? `.${fraction.padEnd(exponent, "0")}` : ""} ${currency}`;
};
