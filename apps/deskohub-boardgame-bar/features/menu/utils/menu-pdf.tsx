import { renderToStream } from "@react-pdf/renderer";
import { Effect } from "effect";
import { LocaleValue } from "@/features/localization/effect-locale";
import { MenuPDFDocument } from "../components/menu-pdf-document";
import { MenuData } from "../data";

export const generateMenuPdf = Effect.gen(function* () {
  yield* Effect.log("Generating menu PDF response");

  const { categories, products } = yield* MenuData;
  const locale = yield* LocaleValue;

  // Generate PDF
  const pdfStream = yield* Effect.promise(() =>
    renderToStream(
      <MenuPDFDocument
        locale={locale}
        products={products}
        categories={categories}
      />
    )
  );

  return pdfStream;
}).pipe(
  Effect.annotateLogs({
    operation: "generateMenuPdfResponse",
  })
);
