import "server-only";

import { join } from "node:path";
import {
  Document,
  Font,
  Page,
  renderToBuffer,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import { Data, Effect } from "effect";
import type { ReactElement } from "react";
import type { InvoiceDocument } from "@/features/accounting/invoice";
import {
  getInvoicePresentation,
  type InvoicePresentation,
  type InvoicePresentationParty,
} from "@/features/accounting/invoice-presentation";

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
  Effect.tryPromise({
    try: () => renderToBuffer(<InvoicePdfDocument document={document} />),
    catch: () =>
      new InvoicePdfRenderingError({
        message: "Invoice PDF could not be rendered.",
      }),
  }).pipe(Effect.withTracerEnabled(false));

const InvoicePdfDocument = ({
  document,
}: {
  readonly document: InvoiceDocument;
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
      <Page size="A4" style={styles.page}>
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

        <View style={styles.factGrid} wrap={false}>
          {presentation.facts.map((fact, index) => (
            <View
              key={fact.label}
              style={index === 3 ? styles.factWide : styles.fact}
            >
              <Text style={styles.label}>{fact.label}</Text>
              <Text style={styles.factValue}>{fact.value}</Text>
            </View>
          ))}
        </View>

        <View style={styles.partyGrid} wrap={false}>
          <Party party={presentation.supplier} />
          <Party party={presentation.buyer} />
        </View>

        <InvoiceLines presentation={presentation} />

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
  factGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 26,
    rowGap: 13,
  },
  fact: {
    paddingRight: 18,
    width: "33.333%",
  },
  factWide: {
    paddingRight: 18,
    width: "66.666%",
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
    minHeight: 142,
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
