import { Effect } from "effect";
import { DotyposServiceLive, getMenuItems } from "@/features/dotypos";
import { MenuClient } from "./menu-client";

export async function MenuServer() {
  const program = getMenuItems().pipe(
    Effect.provide(DotyposServiceLive),
    Effect.tapError((error) =>
      Effect.logError("Failed to fetch menu data", error)
    )
  );

  try {
    const result = await Effect.runPromise(program);

    // Convert Map to array for client component
    const categories = Array.from(result.itemsByCategory.entries()).map(
      ([categoryName, items]) => ({
        name: categoryName,
        items: items,
      })
    );

    return <MenuClient categories={categories} />;
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
