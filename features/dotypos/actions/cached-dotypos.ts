"use server";

import { Effect } from "effect";
import { applyCacheTags, dotyposTags } from "@/shared/utils/cache-tags";
import { DotyposClient, DotyposServiceLive } from "../backend/service";

/**
 * Cached Dotypos service functions using Next.js 'use cache' directive
 * These provide caching wrappers around the Effect-based service
 */

/**
 * Helper to run a Dotypos client operation with proper service provision
 * @internal
 */
function runDotyposOperation<T>(
  operation: (
    client: typeof DotyposClient.Service
    // biome-ignore lint/suspicious/noExplicitAny: Effect.runPromise handles error types internally
  ) => Effect.Effect<T, any, any>
): Promise<T> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* DotyposClient;
      return yield* operation(client);
      // biome-ignore lint/suspicious/noExplicitAny: Type assertion needed for Effect composition
    }).pipe(Effect.provide(DotyposServiceLive)) as Effect.Effect<T, any, never>
  );
}

/**
 * Fetches a reservation by ID with caching
 * @param id - The reservation ID
 * @returns The reservation details
 */
export async function getCachedReservation(id: string) {
  "use cache";

  // Apply cache tags for selective invalidation
  applyCacheTags(...dotyposTags.reservation.getTags(id));

  return runDotyposOperation((client) => client.getReservation(id));
}

/**
 * Fetches a customer by ID with caching
 * @param id - The customer ID
 * @returns The customer details
 */
export async function getCachedCustomer(id: string) {
  "use cache";

  // Apply cache tags for selective invalidation
  applyCacheTags(...dotyposTags.customer.getTags(id));

  return runDotyposOperation((client) => client.getCustomer(id));
}

/**
 * Fetches all available tables with caching
 * @returns List of all tables
 */
export async function getCachedTables() {
  "use cache";

  // Apply cache tags for selective invalidation
  applyCacheTags(...dotyposTags.tables.getTags());

  return runDotyposOperation((client) => client.getTables());
}

/**
 * Fetches products with optional filtering and caching
 * @param options - Filter options
 * @param options.categoryId - Filter by category ID
 * @param options.includeDeleted - Include deleted products
 * @returns List of products matching the criteria
 */
export async function getCachedProducts(options?: {
  categoryId?: string;
  includeDeleted?: boolean;
}) {
  "use cache";

  // Apply cache tags for selective invalidation
  applyCacheTags(...dotyposTags.menu.getTags(options));

  return runDotyposOperation((client) => client.getProducts(options));
}

/**
 * Fetches all product categories with caching
 * @returns List of all categories
 */
export async function getCachedCategories() {
  "use cache";

  // Apply cache tag for all menu items
  applyCacheTags(...dotyposTags.menu.getTags());

  return runDotyposOperation((client) => client.getCategories());
}
