import { PDFViewer } from "@react-pdf/renderer";
import type { ComponentProps } from "react";
import { MenuPDFDocument } from "../menu-pdf-document";

export const MenuPdfDebugViewClientOnly = (
  pdfDocumentProps: ComponentProps<typeof MenuPDFDocument>
) => (
  <PDFViewer
    style={{
      width: "100%",
      height: "calc(100dvh - var(--header-height))",
    }}
  >
    <MenuPDFDocument {...pdfDocumentProps} />
  </PDFViewer>
);
