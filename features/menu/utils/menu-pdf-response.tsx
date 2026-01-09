import { renderToStream } from "@react-pdf/renderer";
import { Effect } from "effect";
import { NextResponse } from "next/server";
import { extractLocaleFromRequest } from "@/features/i18n";
import { MenuPDFDocument } from "../components/menu-pdf-document";
import { MenuService } from "../service";

export const generateMenuPdfResponse = Effect.fn("GenerateMenuPdfResponse")(
  function* (request: Request) {
    yield* Effect.log("Generating menu PDF response");

    const { productsAndCategories } = yield* MenuService;
    const { categories, products } = yield* productsAndCategories;

    // Generate PDF
    const pdfStream = yield* Effect.promise(() =>
      renderToStream(
        <MenuPDFDocument
          locale={extractLocaleFromRequest(request)}
          products={products}
          categories={categories}
        />
      )
    );

    // @ts-expect-error - NextResponse is not typed correctly int he latest Next.js version, remove once it's fixed
    return new NextResponse(pdfStream, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="deskohub-menu.pdf"',
      },
    });
  },
  (effect, input) =>
    effect.pipe(
      Effect.tapError(
        Effect.fn(function* (error) {
          yield* Effect.logError("Failed to generate PDF", error);
        })
      ),
      Effect.annotateLogs({
        operation: "generateMenuPdfResponse",
        input,
      }),
      Effect.orElseSucceed(
        () =>
          new NextResponse("Failed to generate PDF", {
            status: 500,
          })
      )
    )
);
