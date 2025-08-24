"use server";

import { Effect } from "effect";
import {
  DotyposServiceLive,
  getAvailableTables,
  type TableOption,
} from "@/features/dotypos/backend/service";
import { DotyposServiceMockLive } from "@/features/dotypos/backend/service.mock";

const USE_MOCK = process.env.USE_MOCK === "true";
const ServiceLayer = USE_MOCK ? DotyposServiceMockLive : DotyposServiceLive;

/**
 * Server action to get available tables from Dotypos
 */
export async function getTablesAction(): Promise<{
  success: boolean;
  tables?: TableOption[];
  error?: string;
}> {
  const program = getAvailableTables().pipe(
    Effect.map((tables) => ({
      success: true as const,
      tables,
    })),
    Effect.catchAll((error) =>
      Effect.succeed({
        success: false as const,
        error: `Failed to fetch tables: ${error}`,
      })
    )
  );

  const result = await Effect.runPromise(
    program.pipe(Effect.provide(ServiceLayer))
  );

  return result;
}
