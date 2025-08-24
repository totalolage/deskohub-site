import { Effect } from "effect";
import { DotyposServiceLive, getMenuItems } from "@/features/dotypos";
import { siteConstants } from "@/shared/utils/constants";
import { MenuClient } from "./menu-client";

export async function MenuServer() {
  const showPdfDownload = siteConstants.featureFlags.menuPdfDownload;

  const program = getMenuItems().pipe(
    Effect.provide(DotyposServiceLive),
    Effect.tapError((error) =>
      Effect.logError("Failed to fetch menu data", error)
    )
  );

  try {
    const result = await Effect.runPromise(program);

    const categoryIdMap = new Map<string, string>();
    result.categories.forEach((cat) => {
      if (cat.name && cat.id) {
        categoryIdMap.set(cat.name, cat.id);
      }
    });

    const categories = Array.from(result.itemsByCategory.entries()).map(
      ([categoryName, items]) => ({
        id:
          categoryIdMap.get(categoryName) || items[0]?.categoryId || "unknown",
        name: categoryName,
        items: items,
      })
    );

    return (
      <MenuClient categories={categories} showPdfDownload={showPdfDownload} />
    );
  } catch (error) {
    console.error("Error fetching menu data:", error);
    return (
      <div className="max-w-4xl mx-auto px-6 py-16">
        <div className="bg-red-900/20 border border-red-500 text-red-300 px-4 py-3 rounded mb-8">
          Failed to load menu data
        </div>
      </div>
    );
  }
}
