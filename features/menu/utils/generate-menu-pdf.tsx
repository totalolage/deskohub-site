import { renderToBuffer } from "@react-pdf/renderer";
import { Data, Effect, Either } from "effect";
import { NextResponse } from "next/server";
import { DotyposService, isCategoryDisplayable } from "@/features/dotypos";
import type { Category } from "@/features/dotypos/generated";
import { extractLocaleFromRequest } from "@/features/i18n";
import { siteConstants } from "@/shared/utils/constants";
import { MenuPDFDocument } from "../components/menu-pdf-document";

class MenuPdfGenerationError extends Data.TaggedError(
  "MenuPdfGenerationError"
)<{
  readonly cause?: unknown;
  readonly message: string;
}> {}

export const generateMenuPDF = Effect.fn("GenerateMenuPDF")(
  function* (request: Request) {
    yield* Effect.log("Generating menu PDF");

    const locale = extractLocaleFromRequest(request);
    const dotypos = yield* DotyposService;

    // Fetch menu data from Dotypos
    const menuItems = yield* dotypos.getMenuItems().pipe(
      Effect.tapError((error) =>
        Effect.logError("Failed to fetch menu data for PDF", error)
      ),
      Effect.either
    );

    if (Either.isLeft(menuItems))
      return new NextResponse("Failed to fetch menu data", {
        status:
          ("statusCode" in menuItems.left && menuItems.left.statusCode) || 500,
      });

    const { products, categories } = menuItems.right;

    // Get display order for categories from config
    const categoryOrder = [
      ...siteConstants.menu.categoryGroups.food,
      ...siteConstants.menu.categoryGroups.drinks,
    ];

    // Filter and order categories for PDF
    const displayCategories: Category[] = [];
    const categoryMap = new Map(categories.map((cat) => [cat.id, cat]));

    // Add categories in configured order
    categoryOrder.forEach((categoryId) => {
      const category = categoryMap.get(categoryId);
      // Respect the category's display attribute and tags
      if (category && isCategoryDisplayable(category)) {
        // Check if there are products for this category
        const hasProducts = products.some((p) => p._categoryId === categoryId);
        if (hasProducts) {
          displayCategories.push(category);
        }
      }
    });

    // Handle uncategorized items if enabled
    if (siteConstants.menu.showUncategorized) {
      const processedIds = new Set(categoryOrder);

      categories.forEach((category) => {
        // Respect the category's display attribute and tags
        if (
          category.id &&
          !processedIds.has(category.id) &&
          isCategoryDisplayable(category)
        ) {
          // Check if there are products for this category
          const hasProducts = products.some(
            (p) => p._categoryId === category.id
          );
          if (hasProducts) {
            displayCategories.push(category);
          }
        }
      });
    }

    // Generate PDF
    const pdfBuffer = yield* Effect.tryPromise({
      try: () =>
        renderToBuffer(
          <MenuPDFDocument
            categories={displayCategories}
            products={products}
            locale={locale}
          />
        ),
      catch: (error) =>
        new MenuPdfGenerationError({
          message: "Failed to generate menu PDF",
          cause: error,
        }),
    }).pipe(
      Effect.tapError(
        Effect.fn(function* (error) {
          yield* Effect.logError("Failed to generate menu PDF", error);
        })
      ),
      Effect.either
    );

    if (Either.isLeft(pdfBuffer))
      return new NextResponse("Failed to generate menu PDF", { status: 500 });

    return new NextResponse(pdfBuffer.right, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="deskohub-menu.pdf"',
      },
    });
  },
  (effect, input) =>
    effect.pipe(
      Effect.annotateLogs({
        operation: "generateMenuPDF",
        input,
      })
    )
);
