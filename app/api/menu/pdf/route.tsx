import { renderToBuffer } from "@react-pdf/renderer";
import { Effect } from "effect";
import { NextResponse } from "next/server";
import { DotyposServiceLive, getMenuItems } from "@/features/dotypos";
import type { MenuItemWithCategory } from "@/features/dotypos/backend/service";
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

    const result = await Effect.runPromise(program);

    // Group items by category for PDF
    const categorizedItems = Array.from(result.itemsByCategory.entries()).map(
      ([categoryName, items]) => ({
        name: categoryName,
        items: items,
      })
    );

    const groupedCategories = {
      drinks: [] as Array<{ name: string; items: MenuItemWithCategory[] }>,
      food: [] as Array<{ name: string; items: MenuItemWithCategory[] }>,
      other: [] as Array<{ name: string; items: MenuItemWithCategory[] }>,
    };

    // Create a map of category names to IDs
    const categoryIdMap = new Map<string, string>();
    result.categories.forEach((cat) => {
      if (cat.name && cat.id) {
        categoryIdMap.set(cat.name, cat.id);
      }
    });

    // Create a map for quick category lookup by name
    const categoriesByName = new Map(
      categorizedItems.map((cat) => [cat.name, cat])
    );

    // Helper function to add category by ID
    const addCategoryById = (
      categoryId: string,
      targetGroup: Array<{ name: string; items: MenuItemWithCategory[] }>
    ) => {
      // Find category name that matches this ID
      const categoryName = Array.from(categoryIdMap.entries()).find(
        ([_name, id]) => id === categoryId
      )?.[0];

      if (categoryName) {
        const category = categoriesByName.get(categoryName);
        if (
          category &&
          !siteConstants.menu.excludedCategories.includes(categoryId)
        ) {
          targetGroup.push(category);
        }
      }
    };

    // Process food categories in config order
    siteConstants.menu.categoryGroups.food.forEach((categoryId) => {
      addCategoryById(categoryId, groupedCategories.food);
    });

    // Process drinks categories in config order
    siteConstants.menu.categoryGroups.drinks.forEach((categoryId) => {
      addCategoryById(categoryId, groupedCategories.drinks);
    });

    // Process other categories in config order
    siteConstants.menu.categoryGroups.other.forEach((categoryId) => {
      addCategoryById(categoryId, groupedCategories.other);
    });

    // Handle uncategorized items if enabled
    if (siteConstants.menu.showUncategorized) {
      const defaultSection = siteConstants.menu.defaultSection;
      const processedIds = new Set([
        ...siteConstants.menu.categoryGroups.food,
        ...siteConstants.menu.categoryGroups.drinks,
        ...siteConstants.menu.categoryGroups.other,
        ...siteConstants.menu.excludedCategories,
      ]);

      categorizedItems.forEach((category) => {
        const categoryId =
          categoryIdMap.get(category.name) ||
          category.items[0]?.categoryId ||
          "unknown";
        if (!processedIds.has(categoryId) && category.items.length > 0) {
          if (defaultSection === "drinks") {
            groupedCategories.drinks.push(category);
          } else if (defaultSection === "food") {
            groupedCategories.food.push(category);
          } else if (defaultSection === "other") {
            groupedCategories.other.push(category);
          }
        }
      });
    }

    // Generate PDF using React PDF
    const pdfBuffer = await renderToBuffer(
      <MenuPDFDocument categories={groupedCategories} />
    );

    // Return PDF as response
    return new NextResponse(pdfBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${siteConstants.brand.name.toLowerCase()}-menu.pdf"`,
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    });
  } catch (_error) {
    // Error generating PDF - details logged by Effect
    return NextResponse.json(
      { error: "Failed to generate PDF" },
      { status: 500 }
    );
  }
}
