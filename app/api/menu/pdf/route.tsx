import { renderToBuffer } from "@react-pdf/renderer";
import { Effect } from "effect";
import { NextResponse } from "next/server";
import { DotyposServiceLive, getMenuItems } from "@/features/dotypos";
import type { Category } from "@/features/dotypos/generated";
import { MenuPDFDocument } from "@/features/menu/components/menu-pdf-document";
import { siteConstants } from "@/shared/utils/constants";

export async function GET() {
  try {
    // Fetch menu data from Dotypos
    const program = getMenuItems().pipe(
      Effect.provide(DotyposServiceLive),
      Effect.tapError((error) =>
        Effect.logError("Failed to fetch menu data for PDF", error)
      )
    );

    const { products, categories } = await Effect.runPromise(program);

    // Get display order for categories from config
    const categoryOrder = [
      ...siteConstants.menu.categoryGroups.food,
      ...siteConstants.menu.categoryGroups.drinks,
      ...siteConstants.menu.categoryGroups.other,
    ];

    // Filter and order categories for PDF
    const displayCategories: Category[] = [];
    const categoryMap = new Map(categories.map((cat) => [cat.id, cat]));

    // Add categories in configured order
    categoryOrder.forEach((categoryId) => {
      if (!siteConstants.menu.excludedCategories.includes(categoryId)) {
        const category = categoryMap.get(categoryId);
        if (category) {
          // Check if there are products for this category
          const hasProducts = products.some(
            (p) => p._categoryId === categoryId
          );
          if (hasProducts) {
            displayCategories.push(category);
          }
        }
      }
    });

    // Handle uncategorized items if enabled
    if (siteConstants.menu.showUncategorized) {
      const processedIds = new Set([
        ...categoryOrder,
        ...siteConstants.menu.excludedCategories,
      ]);

      categories.forEach((category) => {
        if (category.id && !processedIds.has(category.id)) {
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
    const pdfBuffer = await renderToBuffer(
      <MenuPDFDocument categories={displayCategories} products={products} />
    );

    // Return PDF response
    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="deskohub-menu.pdf"',
      },
    });
  } catch (error) {
    console.error("Failed to generate menu PDF:", error);
    return new NextResponse("Failed to generate menu PDF", { status: 500 });
  }
}
