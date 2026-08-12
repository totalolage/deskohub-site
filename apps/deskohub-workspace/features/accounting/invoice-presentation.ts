import { Match } from "effect";
import type { InvoiceDocument } from "@/features/accounting/invoice";
import { formatWorkspaceMoney } from "@/features/checkout/workspace-money";
import type { Locale } from "@/features/i18n";
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

export interface InvoicePresentation {
  readonly locale: Locale;
  readonly title: string;
  readonly invoiceNumber: string;
  readonly status: string;
  readonly facts: readonly {
    readonly label: string;
    readonly value: string;
  }[];
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

const invoiceCopy = {
  "cs-CZ": {
    title: "Faktura",
    paid: "Uhrazeno",
    invoiceNumber: "Číslo faktury",
    issueDate: "Datum vystavení",
    paymentDate: "Datum úhrady",
    serviceDate: "Datum plnění",
    reservationReference: "Číslo objednávky",
    supplier: "Dodavatel",
    buyer: "Odběratel",
    companyId: "IČO",
    vatId: "DIČ",
    commercialRegister: "Obchodní rejstřík",
    description: "Popis",
    amount: "Částka",
    totalPaid: "Celkem uhrazeno",
    nonVatPayer: "Nejsme plátci DPH.",
    coworkProducts: {
      basic: "Basic Day Pass",
      plus: "Cowork Plus",
      profi: "Profi Workstation",
    },
    coffee: "Káva",
    meetingRoom: "Zasedací místnost",
    office: "Soukromá kancelář",
    discount: "Sleva",
    hour: (count) => `${count} ${count === 1 ? "hodina" : "hodiny"}`,
    day: (count) => `${count} ${count === 1 ? "den" : "dny"}`,
    seat: (count) => `${count} ${count === 1 ? "místo" : "místa"}`,
  },
  "en-US": {
    title: "Invoice",
    paid: "Paid",
    invoiceNumber: "Invoice number",
    issueDate: "Issue date",
    paymentDate: "Payment date",
    serviceDate: "Service date",
    reservationReference: "Order reference",
    supplier: "Supplier",
    buyer: "Customer",
    companyId: "Company ID",
    vatId: "VAT ID",
    commercialRegister: "Commercial register",
    description: "Description",
    amount: "Amount",
    totalPaid: "Total paid",
    nonVatPayer: "The supplier is not registered for VAT.",
    coworkProducts: {
      basic: "Basic Day Pass",
      plus: "Cowork Plus",
      profi: "Profi Workstation",
    },
    coffee: "Coffee",
    meetingRoom: "Meeting room",
    office: "Private office",
    discount: "Discount",
    hour: (count) => `${count} ${count === 1 ? "hour" : "hours"}`,
    day: (count) => `${count} ${count === 1 ? "day" : "days"}`,
    seat: (count) => `${count} ${count === 1 ? "seat" : "seats"}`,
  },
} satisfies Record<Locale, InvoiceCopy>;

export const getInvoicePresentation = (
  document: InvoiceDocument
): InvoicePresentation => {
  const { locale } = document;
  const copy = invoiceCopy[locale];

  return {
    locale,
    title: copy.title,
    invoiceNumber: document.invoiceNumber,
    status: copy.paid,
    facts: [
      { label: copy.invoiceNumber, value: document.invoiceNumber },
      {
        label: copy.issueDate,
        value: formatInstantDate(document.issuedAt, locale),
      },
      {
        label: copy.paymentDate,
        value: formatInstantDate(document.paidAt, locale),
      },
      {
        label: copy.serviceDate,
        value: formatServiceDate(document, locale),
      },
      {
        label: copy.reservationReference,
        value: document.workspaceReservationId,
      },
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
        `${copy.commercialRegister}: ${document.supplier.commercialRegister.section} ${document.supplier.commercialRegister.file}, ${document.supplier.commercialRegister.court}`,
        document.supplier.contactEmail,
      ],
    },
    buyer: getBuyerPresentation(document, copy),
    lineDescriptionHeading: copy.description,
    lineAmountHeading: copy.amount,
    lines: [
      ...getItemLines(document, copy),
      ...document.quote.payment.discounts.map(
        ({ amount, discount }): InvoicePresentationLine => ({
          kind: "discount",
          description: `${copy.discount}: ${discount.label}`,
          amount: `−${formatWorkspaceMoney(amount, locale)}`,
        })
      ),
    ],
    totalLabel: copy.totalPaid,
    total: formatWorkspaceMoney(document.quote.payment.expectedPrice, locale),
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
  const details = address
    ? [
        address.line1,
        address.line2,
        `${address.postalCode ?? ""} ${address.city ?? ""}`.trim(),
        address.country ? formatCountry(address.country, locale) : undefined,
      ].filter((line): line is string => Boolean(line))
    : [];

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
): readonly InvoicePresentationLine[] =>
  document.quote.items.map(
    (item): InvoicePresentationLine =>
      Match.value(item).pipe(
        Match.discriminatorsExhaustive("type")({
          cowork: ({ amount, tier }) => ({
            kind: "item",
            description: copy.coworkProducts[tier],
            amount: formatWorkspaceMoney(amount, document.locale),
          }),
          coffee: ({ amount }) => ({
            kind: "item",
            description: copy.coffee,
            amount: formatWorkspaceMoney(amount, document.locale),
          }),
          "meeting-room": ({ amount, duration }) => {
            const durationLabel =
              duration.unit === "day"
                ? copy.day(duration.amount)
                : copy.hour(duration.amount);
            return {
              kind: "item",
              description: `${copy.meetingRoom} · ${durationLabel}`,
              amount: formatWorkspaceMoney(amount, document.locale),
            };
          },
          office: ({ amount, dayCount, seats }) => ({
            kind: "item",
            description: `${copy.office} · ${copy.day(dayCount)} · ${copy.seat(seats)}`,
            amount: formatWorkspaceMoney(amount, document.locale),
          }),
        })
      )
  );

const formatServiceDate = (document: InvoiceDocument, locale: Locale) => {
  switch (document.reservation.kind) {
    case "cowork":
      return formatPlainDate(document.reservation.date, locale);
    case "meeting-room":
      return formatInstantRange(
        document.reservation.startsAt,
        document.reservation.endsAt,
        locale
      );
    case "office":
      return formatPlainDateRange(
        document.reservation.startsOn,
        document.reservation.endsOn,
        locale
      );
  }
};

const formatInstantDate = (value: string, locale: Locale) =>
  new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: workspaceSiteConstants.location.timeZone,
  }).format(new Date(value));

const formatInstantRange = (start: string, end: string, locale: Locale) =>
  new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: workspaceSiteConstants.location.timeZone,
  }).formatRange(new Date(start), new Date(end));

const formatPlainDate = (value: string, locale: Locale) =>
  new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));

const formatPlainDateRange = (start: string, end: string, locale: Locale) =>
  new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).formatRange(new Date(`${start}T12:00:00Z`), new Date(`${end}T12:00:00Z`));

const formatCountry = (country: string, locale: Locale) => {
  try {
    return (
      new Intl.DisplayNames([locale], { type: "region" }).of(country) ?? country
    );
  } catch {
    return country;
  }
};
