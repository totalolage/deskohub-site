#!/usr/bin/env bun

/**
 * Script to fetch and display Dotypos categories
 * Run with: bun run scripts/fetch-categories.ts
 */

import { Effect } from "effect";
import { DotyposClient, DotyposServiceLive } from "@/features/dotypos";

const program = Effect.gen(function* () {
  console.log("🔄 Fetching categories from Dotypos API...\n");

  const client = yield* DotyposClient;

  try {
    // Fetch categories
    const categories = yield* client.getCategories();

    console.log(`✅ Found ${categories.length} categories:\n`);
    console.log("=".repeat(80));

    // Sort categories by name for easier reading
    const sortedCategories = [...categories].sort((a, b) =>
      (a.name || "").localeCompare(b.name || "")
    );

    // Display categories in a table format
    console.log(
      "ID".padEnd(20) +
        "| " +
        "Name".padEnd(30) +
        "| " +
        "Display" +
        " | " +
        "Deleted"
    );
    console.log("-".repeat(80));

    for (const category of sortedCategories) {
      const id = category.id || "N/A";
      const name = category.name || "Unnamed";
      const display = category.display ? "✅" : "❌";
      const deleted = category.deleted ? "❌" : "✅";

      console.log(
        id.padEnd(20) +
          "| " +
          name.padEnd(30) +
          "| " +
          display.padEnd(7) +
          " | " +
          deleted
      );
    }

    console.log(`\n${"=".repeat(80)}`);
    console.log("\n📝 Configuration Helper:\n");
    console.log(
      "Copy the IDs above to update shared/utils/constants.ts in the siteConstants.menu section"
    );
    console.log("\nExample configuration:");
    console.log(`
// In shared/utils/constants.ts:
menu: {
  categoryGroups: {
    food: [
      // Add food category IDs here, e.g.:
      "${sortedCategories[0]?.id || "123456789"}",  // ${sortedCategories[0]?.name || "Category Name"}
    ],
    drinks: [
      // Add drink category IDs here
    ],
    other: [
      // Add other category IDs here (games, etc.)
    ],
  },
  excludedCategories: [
    // Add IDs of categories to hide completely
  ],
},`);

    // Also save to a JSON file for reference
    const outputPath = ".taskmaster/docs/dotypos-categories.json";
    const fs = yield* Effect.promise(() => import("node:fs/promises"));
    const path = yield* Effect.promise(() => import("node:path"));

    // Ensure directory exists
    yield* Effect.promise(() =>
      fs.mkdir(path.dirname(outputPath), { recursive: true })
    );

    // Save categories data
    yield* Effect.promise(() =>
      fs.writeFile(
        outputPath,
        JSON.stringify(
          {
            timestamp: new Date().toISOString(),
            totalCategories: categories.length,
            categories: sortedCategories.map((cat) => ({
              id: cat.id,
              name: cat.name,
              display: cat.display,
              deleted: cat.deleted,
              hexColor: cat.hexColor,
              ordering: cat.ordering,
            })),
          },
          null,
          2
        )
      )
    );

    console.log(`\n💾 Category data saved to: ${outputPath}`);
  } catch (error) {
    console.error("❌ Error fetching categories:", error);
    throw error;
  }
});

// Run the program with the live service
const runnable = program.pipe(
  Effect.provide(DotyposServiceLive),
  Effect.tapError((error) =>
    Effect.sync(() => {
      console.error("\n❌ Failed to fetch categories:", error);
      process.exit(1);
    })
  )
);

// Execute the program
Effect.runPromise(runnable).catch((error) => {
  console.error("Unexpected error:", error);
  process.exit(1);
});
