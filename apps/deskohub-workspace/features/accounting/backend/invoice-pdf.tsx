import "server-only";

import { join } from "node:path";
import {
  Document,
  Font,
  Image,
  Page,
  renderToBuffer,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import { Data, Effect } from "effect";
import type { ReactElement } from "react";
import {
  type InvoiceDocument,
  isManualInvoiceDocument,
} from "@/features/accounting/invoice";
import {
  getInvoicePresentation,
  type InvoicePresentation,
  type InvoicePresentationParty,
} from "@/features/accounting/invoice-presentation";
import {
  getInvoicePaymentRequest,
  type InvoicePaymentRequest,
} from "./invoice-payment-qr";

const invoiceFontFamily = "Sculpin";
const invoiceFontPath = join(
  process.cwd(),
  "assets",
  "fonts",
  "Sculpin",
  "regular.ttf"
);

Font.register({
  family: invoiceFontFamily,
  fonts: [
    { src: invoiceFontPath, fontWeight: 400 },
    { src: invoiceFontPath, fontWeight: 700 },
  ],
});
Font.registerHyphenationCallback((word) => [word]);

export class InvoicePdfRenderingError extends Data.TaggedError(
  "InvoicePdfRenderingError"
)<{
  readonly message: string;
}> {}

export const renderInvoicePdf = (
  document: InvoiceDocument
): Effect.Effect<Buffer, InvoicePdfRenderingError> =>
  (isManualInvoiceDocument(document)
    ? getInvoicePaymentRequest(document)
    : Effect.succeed(null)
  ).pipe(
    Effect.mapError(
      () =>
        new InvoicePdfRenderingError({
          message: "Invoice payment QR code could not be rendered.",
        })
    ),
    Effect.flatMap((payment) =>
      Effect.tryPromise({
        try: () =>
          renderToBuffer(
            <InvoicePdfDocument document={document} payment={payment} />
          ),
        catch: () =>
          new InvoicePdfRenderingError({
            message: "Invoice PDF could not be rendered.",
          }),
      })
    ),
    Effect.withTracerEnabled(false)
  );

const InvoicePdfDocument = ({
  document,
  payment,
}: {
  readonly document: InvoiceDocument;
  readonly payment: InvoicePaymentRequest | null;
}): ReactElement => {
  const presentation = getInvoicePresentation(document);
  const issuedAt = new Date(document.issuedAt);

  return (
    <Document
      author={document.supplier.legalName}
      creationDate={issuedAt}
      creator="Deskohub Workspace"
      language={document.locale}
      modificationDate={issuedAt}
      subject={`${presentation.title} ${document.invoiceNumber}`}
      title={`${presentation.title} ${document.invoiceNumber}`}
    >
      <Page
        size="A4"
        style={payment ? [styles.page, styles.manualPage] : styles.page}
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>DESKOHUB WORKSPACE</Text>
            <Text style={styles.title}>{presentation.title}</Text>
            <Text style={styles.invoiceNumber}>
              {presentation.invoiceNumber}
            </Text>
          </View>
          <Text style={styles.status}>{presentation.status}</Text>
        </View>

        <View style={styles.factColumns} wrap={false}>
          {presentation.factColumns.map((column) => (
            <View key={column[0].label} style={styles.factColumn}>
              {column.map((fact) =>
                fact ? (
                  <View key={fact.label} style={styles.fact}>
                    <Text style={styles.label}>{fact.label}</Text>
                    <Text style={styles.factValue}>{fact.value}</Text>
                  </View>
                ) : null
              )}
            </View>
          ))}
        </View>

        <View style={styles.partyGrid} wrap={false}>
          <Party party={presentation.supplier} />
          <Party party={presentation.buyer} />
        </View>

        <InvoiceLines presentation={presentation} />

        {payment ? (
          <PaymentRequest payment={payment} locale={document.locale} />
        ) : null}

        <View style={styles.nonVatNote} wrap={false}>
          <Text>{presentation.nonVatStatement}</Text>
        </View>

        <View fixed style={styles.footer}>
          <Text>{presentation.footer}</Text>
          <Text
            render={({ pageNumber, totalPages }) =>
              `${pageNumber} / ${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  );
};

const Party = ({
  party,
}: {
  readonly party: InvoicePresentationParty;
}): ReactElement => (
  <View style={styles.party}>
    <Text style={styles.sectionHeading}>{party.heading}</Text>
    <Text style={styles.partyName}>{party.name}</Text>
    {party.details.map((line) => (
      <Text key={line} style={styles.partyDetail}>
        {line}
      </Text>
    ))}
  </View>
);

const PaymentRequest = ({
  payment,
  locale,
}: {
  readonly payment: InvoicePaymentRequest;
  readonly locale: "cs-CZ" | "en-US";
}): ReactElement => {
  const labels =
    locale === "cs-CZ"
      ? {
          heading: "Platební údaje",
          account: "Účet",
          iban: "IBAN",
          variableSymbol: "Variabilní symbol",
          dueDate: "Splatnost",
        }
      : {
          heading: "Payment details",
          account: "Account",
          iban: "IBAN",
          variableSymbol: "Variable symbol",
          dueDate: "Due date",
        };
  return (
    <View style={styles.paymentRequest} wrap={false}>
      <View style={styles.paymentDetails}>
        <Text style={styles.sectionHeading}>{labels.heading}</Text>
        <Text>{`${labels.account}: ${payment.accountNumber}`}</Text>
        <Text>{`${labels.iban}: ${payment.iban}`}</Text>
        <Text>{`BIC: ${payment.bic}`}</Text>
        <Text>{`${labels.variableSymbol}: ${payment.variableSymbol}`}</Text>
        <Text>{`${labels.dueDate}: ${payment.dueDate}`}</Text>
      </View>
      {payment.qrCode ? (
        <Image
          src={`data:image/png;base64,${payment.qrCode.toString("base64")}`}
          style={styles.paymentQr}
        />
      ) : null}
    </View>
  );
};

const InvoiceLines = ({
  presentation,
}: {
  readonly presentation: InvoicePresentation;
}): ReactElement => (
  <View style={styles.linesSection}>
    <View style={styles.lineHeader} fixed>
      <Text style={styles.lineDescription}>
        {presentation.lineDescriptionHeading}
      </Text>
      <Text style={styles.lineAmount}>{presentation.lineAmountHeading}</Text>
    </View>
    {presentation.lines.map((line, index) => (
      <View
        // biome-ignore lint/suspicious/noArrayIndexKey: Issued invoice lines are ordered and may contain duplicate descriptions and amounts.
        key={`${line.kind}-${index}`}
        style={line.kind === "discount" ? styles.discountLine : styles.line}
        wrap={false}
      >
        <Text style={styles.lineDescription}>{line.description}</Text>
        <Text style={styles.lineAmount}>{line.amount}</Text>
      </View>
    ))}
    <View style={styles.totalLine} wrap={false}>
      <Text style={styles.totalLabel}>{presentation.totalLabel}</Text>
      <Text style={styles.totalAmount}>{presentation.total}</Text>
    </View>
  </View>
);

const styles = StyleSheet.create({
  page: {
    backgroundColor: "#ffffff",
    color: "#152a3a",
    fontFamily: invoiceFontFamily,
    fontSize: 10,
    lineHeight: 1.4,
    paddingBottom: 64,
    paddingHorizontal: 46,
    paddingTop: 42,
  },
  manualPage: {
    fontSize: 9,
    paddingBottom: 44,
    paddingTop: 24,
  },
  header: {
    alignItems: "flex-start",
    borderBottomColor: "#dce3e7",
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 24,
    paddingBottom: 20,
  },
  eyebrow: {
    color: "#d15a35",
    fontSize: 9,
    letterSpacing: 1.8,
    marginBottom: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: 700,
    lineHeight: 1.05,
  },
  invoiceNumber: {
    color: "#536773",
    fontSize: 11,
    marginTop: 7,
  },
  status: {
    backgroundColor: "#dff2ea",
    borderRadius: 12,
    color: "#176b50",
    fontSize: 9,
    fontWeight: 700,
    paddingHorizontal: 12,
    paddingVertical: 6,
    textTransform: "uppercase",
  },
  factColumns: {
    flexDirection: "row",
    gap: 24,
    marginBottom: 26,
  },
  factColumn: {
    flexBasis: 0,
    flexGrow: 1,
    gap: 13,
  },
  fact: {
    paddingRight: 18,
  },
  label: {
    color: "#70818b",
    fontSize: 8,
    marginBottom: 3,
    textTransform: "uppercase",
  },
  factValue: {
    fontSize: 10,
    fontWeight: 700,
  },
  partyGrid: {
    flexDirection: "row",
    gap: 24,
    marginBottom: 28,
  },
  party: {
    backgroundColor: "#f5f7f8",
    borderRadius: 5,
    minHeight: 120,
    padding: 16,
    width: "50%",
  },
  sectionHeading: {
    color: "#d15a35",
    fontSize: 8,
    letterSpacing: 1.2,
    marginBottom: 9,
    textTransform: "uppercase",
  },
  partyName: {
    fontSize: 12,
    fontWeight: 700,
    marginBottom: 5,
  },
  partyDetail: {
    color: "#455b68",
    fontSize: 9,
    marginBottom: 1,
  },
  linesSection: {
    marginBottom: 20,
  },
  lineHeader: {
    borderBottomColor: "#9eacb4",
    borderBottomWidth: 1,
    color: "#70818b",
    flexDirection: "row",
    fontSize: 8,
    paddingBottom: 7,
    textTransform: "uppercase",
  },
  line: {
    borderBottomColor: "#e5eaed",
    borderBottomWidth: 1,
    flexDirection: "row",
    paddingVertical: 10,
  },
  discountLine: {
    borderBottomColor: "#e5eaed",
    borderBottomWidth: 1,
    color: "#176b50",
    flexDirection: "row",
    paddingVertical: 10,
  },
  lineDescription: {
    paddingRight: 16,
    width: "74%",
  },
  lineAmount: {
    textAlign: "right",
    width: "26%",
  },
  totalLine: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingTop: 14,
  },
  totalLabel: {
    fontSize: 11,
    fontWeight: 700,
    marginRight: 16,
  },
  totalAmount: {
    color: "#d15a35",
    fontSize: 18,
    fontWeight: 700,
    minWidth: 120,
    textAlign: "right",
  },
  nonVatNote: {
    backgroundColor: "#fff6ed",
    borderLeftColor: "#d15a35",
    borderLeftWidth: 3,
    color: "#70442f",
    fontSize: 9,
    marginTop: 8,
    padding: 11,
  },
  paymentRequest: {
    alignItems: "center",
    backgroundColor: "#f5f7f8",
    borderRadius: 5,
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
    padding: 10,
  },
  paymentDetails: {
    gap: 3,
  },
  paymentQr: {
    height: 88,
    width: 88,
  },
  footer: {
    bottom: 22,
    color: "#81909a",
    flexDirection: "row",
    fontSize: 8,
    justifyContent: "space-between",
    left: 46,
    position: "absolute",
    right: 46,
  },
});
