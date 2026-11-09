import { Match, Option } from "effect";
import {
  type InvoiceDocument,
  isManualInvoiceDocument,
  type ManualInvoiceDocument,
} from "@/features/accounting/invoice";
import {
  getInvoiceSettlement,
  getInvoiceTotal,
  type InvoiceTotal,
} from "@/features/accounting/invoice-settlement";
import type { WorkspaceCoworkProductTier } from "@/features/checkout/product-catalog";
import { getWorkspaceProductTierTitle } from "@/features/checkout/product-catalog.i18n";
import { type Locale, m } from "@/features/i18n";
import { findWorkspaceCurrencyDefinition } from "@/shared/money/currencies";
import { formatMoney } from "@/shared/money/money";
import {
  formatInstantDate,
  formatPlainDate,
} from "@/shared/utils/date-time-format";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";

export interface InvoicePresentationParty {
  readonly heading: string;
  readonly name: string;
  readonly details: readonly string[];
}

interface InvoicePresentationLine {
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
  readonly unpaid: string;
  readonly issued: string;
  readonly invoiceNumber: string;
  readonly issueDate: string;
  readonly paymentDate: string;
  readonly dueDate: string;
  readonly variableSymbol: string;
  readonly serviceDate: string;
  readonly reservationReference: string;
  readonly supplier: string;
  readonly buyer: string;
  readonly companyId: string;
  readonly vatId: string;
  readonly commercialRegister: string;
  readonly description: string;
  readonly amount: string;
  readonly total: string;
  readonly totalPaid: string;
  readonly totalDue: string;
  readonly nonVatPayer: string;
  readonly coworkProducts: Readonly<Record<WorkspaceCoworkProductTier, string>>;
  readonly coffee: string;
  readonly workstation: string;
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
  unpaid: m.invoiceManualUnpaid({}, { locale }),
  issued: m.invoiceManualIssued({}, { locale }),
  invoiceNumber: m.invoiceNumberLabel({}, { locale }),
  issueDate: m.invoiceIssueDateLabel({}, { locale }),
  paymentDate: m.invoicePaymentDateLabel({}, { locale }),
  dueDate: m.invoiceManualDueDate({}, { locale }),
  variableSymbol: m.invoiceManualVariableSymbol({}, { locale }),
  serviceDate: m.invoiceServiceDateLabel({}, { locale }),
  reservationReference: m.invoiceReservationReferenceLabel({}, { locale }),
  supplier: m.invoiceSupplierLabel({}, { locale }),
  buyer: m.invoiceBuyerLabel({}, { locale }),
  companyId: m.invoiceCompanyIdLabel({}, { locale }),
  vatId: m.invoiceVatIdLabel({}, { locale }),
  commercialRegister: m.invoiceCommercialRegisterLabel({}, { locale }),
  description: m.invoiceDescriptionLabel({}, { locale }),
  amount: m.invoiceAmountLabel({}, { locale }),
  total: m.invoiceManualTotal({}, { locale }),
  totalPaid: m.invoiceTotalPaidLabel({}, { locale }),
  totalDue: m.invoiceManualTotalDue({}, { locale }),
  nonVatPayer: m.invoiceNonVatPayerStatement({}, { locale }),
  coworkProducts: {
    "open-space": getWorkspaceProductTierTitle("open-space", locale),
    "reserved-desk": getWorkspaceProductTierTitle("reserved-desk", locale),
    basic: getWorkspaceProductTierTitle("basic", locale),
    plus: getWorkspaceProductTierTitle("plus", locale),
    profi: getWorkspaceProductTierTitle("profi", locale),
  },
  coffee: m.invoiceCoffeeLineLabel({}, { locale }),
  workstation: m.invoiceWorkstationLineLabel({}, { locale }),
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
  const settlement = getSettlementPresentation(document, copy);

  return {
    locale,
    title: copy.title,
    invoiceNumber: document.invoiceNumber,
    status: settlement.status,
    factColumns: [
      [
        { label: copy.invoiceNumber, value: document.invoiceNumber },
        {
          label: copy.reservationReference,
          value: document.workspaceReservationId,
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
      ...document.quote.payment.discounts.map(
        ({ amount, discount }): InvoicePresentationLine => ({
          kind: "discount",
          description: `${copy.discount}: ${discount.label}`,
          amount: `−${formatMoney(amount, locale)}`,
        })
      ),
    ],
    totalLabel: settlement.totalLabel,
    total: formatMoney(document.quote.payment.expectedPrice, locale),
    nonVatStatement: copy.nonVatPayer,
    footer: `${document.supplier.legalName} · ${document.supplier.contactEmail}`,
  };
};

const getManualInvoicePresentation = (
  document: ManualInvoiceDocument
): InvoicePresentation => {
  const copy = getInvoiceCopy(document.locale);
  const settlement = getSettlementPresentation(document, copy);

  return {
    locale: document.locale,
    title: copy.title,
    invoiceNumber: document.invoiceNumber,
    factColumns: [
      [
        { label: copy.invoiceNumber, value: document.invoiceNumber },
        settlement.variableSymbolFact,
      ],
      [
        {
          label: copy.issueDate,
          value: formatWorkspaceInstantDate(document.issuedAt, document.locale),
        },
        {
          label: copy.serviceDate,
          value: formatInvoicePlainDate(document.serviceDate, document.locale),
        },
        settlement.dateFact,
      ],
    ],
    supplier: getSupplierPresentation(document, copy),
    buyer: getBuyerPresentation(document, copy),
    lineDescriptionHeading: copy.description,
    lineAmountHeading: copy.amount,
    lines: document.lines.map((line) => ({
      kind: "item" as const,
      description: line.description,
      amount: formatManualMoney({
        amount: line.price,
        currency: document.currency,
      }),
    })),
    status: settlement.status,
    totalLabel: settlement.totalLabel,
    total: formatManualMoney(getInvoiceTotal(document)),
    nonVatStatement: copy.nonVatPayer,
    footer: `${document.supplier.legalName} · ${document.supplier.contactEmail}`,
  };
};

/** The status, total label, and payment facts an invoice's settlement prints. */
const getSettlementPresentation = (
  document: InvoiceDocument,
  copy: InvoiceCopy
): {
  readonly status: string;
  readonly totalLabel: string;
  readonly dateFact: InvoicePresentationFact | null;
  readonly variableSymbolFact: InvoicePresentationFact | null;
} => {
  const { locale } = document;
  const variableSymbolFact = (variableSymbol: string | null) =>
    variableSymbol
      ? { label: copy.variableSymbol, value: variableSymbol }
      : null;

  return Match.value(getInvoiceSettlement(document)).pipe(
    Match.tagsExhaustive({
      Paid: ({ paidOn, variableSymbol }) => ({
        status: copy.paid,
        totalLabel: copy.totalPaid,
        dateFact: paidOn
          ? {
              label: copy.paymentDate,
              value: formatInvoicePlainDate(paidOn, locale),
            }
          : null,
        variableSymbolFact: variableSymbolFact(variableSymbol),
      }),
      PaymentRequested: ({ dueDate, variableSymbol }) => ({
        status: copy.unpaid,
        totalLabel: copy.totalDue,
        dateFact: {
          label: copy.dueDate,
          value: formatInvoicePlainDate(dueDate, locale),
        },
        variableSymbolFact: variableSymbolFact(variableSymbol),
      }),
      NothingDue: () => ({
        status: copy.issued,
        totalLabel: copy.total,
        dateFact: null,
        variableSymbolFact: null,
      }),
    })
  );
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
): readonly InvoicePresentationLine[] =>
  document.quote.items.map(
    (item): InvoicePresentationLine =>
      Match.value(item).pipe(
        Match.discriminatorsExhaustive("type")({
          cowork: ({ amount, tier }) => ({
            kind: "item" as const,
            description: copy.coworkProducts[tier],
            amount: formatMoney(amount, document.locale),
          }),
          coffee: ({ amount }) => ({
            kind: "item" as const,
            description: copy.coffee,
            amount: formatMoney(amount, document.locale),
          }),
          workstation: ({ amount }) => ({
            kind: "item" as const,
            description: copy.workstation,
            amount: formatMoney(amount, document.locale),
          }),
          "meeting-room": ({ amount, duration }) => {
            const durationLabel =
              duration.unit === "day"
                ? copy.day(duration.amount)
                : copy.hour(duration.amount);
            return {
              kind: "item" as const,
              description: `${copy.meetingRoom} · ${durationLabel}`,
              amount: formatMoney(amount, document.locale),
            };
          },
          office: ({ amount, dayCount, seats }) => ({
            kind: "item" as const,
            description: `${copy.office} · ${copy.day(dayCount)} · ${copy.seat(seats)}`,
            amount: formatMoney(amount, document.locale),
          }),
        })
      )
  );

const formatWorkspaceInstantDate = (value: string, locale: Locale) =>
  formatInstantDate({
    instant: Temporal.Instant.from(value),
    locale,
    timeZone: workspaceSiteConstants.location.timeZone,
  });

const displayRegionName = Option.liftThrowable(
  (country: string, locale: Locale) =>
    new Intl.DisplayNames([locale], { type: "region" }).of(country)
);

/** The localized region name, or the stored code when Intl has no name. */
const formatCountry = (country: string, locale: Locale) =>
  displayRegionName(country, locale).pipe(
    Option.flatMap(Option.fromNullishOr),
    Option.getOrElse(() => country)
  );

const formatInvoicePlainDate = (value: string, locale: Locale) =>
  formatPlainDate({ date: Temporal.PlainDate.from(value), locale });

/** Manual invoices print plain decimal text and the code, such as "1234.50 CZK". */
const formatManualMoney = ({ amount, currency }: InvoiceTotal) => {
  const exponent = findWorkspaceCurrencyDefinition(currency)?.exponent ?? 0;
  const [integer, fraction = ""] = amount.split(".");
  return `${integer}${exponent > 0 ? `.${fraction.padEnd(exponent, "0")}` : ""} ${currency}`;
};
