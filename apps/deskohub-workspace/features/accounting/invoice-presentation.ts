import { Match } from "effect";
import {
  getInvoiceOrderId,
  type InvoiceDocument,
} from "@/features/accounting/invoice";
import { getWorkspaceProductTierTitle } from "@/features/checkout/product-catalog.i18n";
import { formatWorkspaceMoney } from "@/features/checkout/workspace-money";
import { type Locale, m } from "@/features/i18n";
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
    readonly [InvoicePresentationFact, InvoicePresentationFact],
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
    supplier: {
      heading: copy.supplier,
      name: document.supplier.legalName,
      details: [
        document.supplier.address.street,
        document.supplier.address.cityDistrict,
        `${document.supplier.address.postalCode} ${document.supplier.address.city}`,
        formatCountry(document.supplier.address.country, locale),
        `${copy.companyId}: ${document.supplier.companyId}`,
        ...(document.supplier.commercialRegister
          ? [
              `${copy.commercialRegister}: ${document.supplier.commercialRegister.section} ${document.supplier.commercialRegister.file}, ${document.supplier.commercialRegister.court}`,
            ]
          : []),
        document.supplier.contactEmail,
      ],
    },
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

const getItemLines = (
  document: InvoiceDocument,
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
  document: InvoiceDocument,
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

const getInvoiceTotal = (document: InvoiceDocument) =>
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
