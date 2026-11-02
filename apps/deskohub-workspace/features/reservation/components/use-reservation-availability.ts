"use client";

import {
  hashKey,
  keepPreviousData,
  skipToken,
  type UseQueryOptions,
  type UseQueryResult,
  useQuery,
} from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  type PreloadedWorkspaceAvailability,
  type WorkspaceAvailability,
  type WorkspaceAvailabilityQuery,
  workspaceAvailabilityKeys,
} from "@/features/reservation/workspace-availability";
import { loadWorkspaceAvailability } from "@/features/reservation/workspace-availability-client";

type UseReservationAvailabilityOptions = {
  readonly debounceMs?: number;
  /** Server-loaded availability, used only for a query it was loaded for. */
  readonly initialAvailability?: ReadonlyArray<PreloadedWorkspaceAvailability>;
  readonly keepPreviousData?: boolean;
  readonly replacementToken?: string;
};

const useDebouncedAvailabilityQuery = (
  query: WorkspaceAvailabilityQuery | undefined,
  debounceMs: number
) => {
  const [debouncedQuery, setDebouncedQuery] = useState(query);

  useEffect(() => {
    if (debounceMs <= 0 || query === debouncedQuery) return;

    const timeout = setTimeout(() => setDebouncedQuery(query), debounceMs);
    return () => clearTimeout(timeout);
  }, [debounceMs, debouncedQuery, query]);

  return debounceMs > 0
    ? {
        isDebouncing: query !== debouncedQuery,
        query: debouncedQuery,
      }
    : { isDebouncing: false, query };
};

// Matches by the query key hash, the identity TanStack Query caches under.
const findPreloadedAvailability = (
  initialAvailability: ReadonlyArray<PreloadedWorkspaceAvailability> = [],
  query: WorkspaceAvailabilityQuery
) => {
  const queryHash = hashKey([query]);
  return initialAvailability.find(
    (preloaded) => hashKey([preloaded.query]) === queryHash
  );
};

type AvailabilityQueryResult = UseQueryResult<WorkspaceAvailability>;

type AvailabilityQueryOptions = Pick<
  UseQueryOptions<WorkspaceAvailability>,
  "initialData" | "initialDataUpdatedAt" | "queryFn" | "queryKey"
>;

/** The cache entry and request for a query, seeded from a matching preload. */
const getAvailabilityQueryOptions = (
  query: WorkspaceAvailabilityQuery,
  {
    initialAvailability,
    replacementToken,
  }: Pick<
    UseReservationAvailabilityOptions,
    "initialAvailability" | "replacementToken"
  >
): AvailabilityQueryOptions => {
  const preloaded = findPreloadedAvailability(initialAvailability, query);
  return {
    queryKey: [
      ...workspaceAvailabilityKeys.availability(query),
      replacementToken ?? null,
    ],
    queryFn: ({ signal }) =>
      loadWorkspaceAvailability({ query, signal, replacementToken }),
    initialData: preloaded?.availability,
    initialDataUpdatedAt: preloaded?.loadedAt,
  };
};

const emptyAvailabilityQueryOptions: AvailabilityQueryOptions = {
  queryKey: ["workspace-availability", "empty"],
  queryFn: skipToken,
  initialData: undefined,
  initialDataUpdatedAt: undefined,
};

/**
 * Whether the query still waits for a usable response: loading, showing a
 * previous key's placeholder, or retrying after a failure (an errored query
 * keeps its error status while it refetches stale data). A background refetch
 * of successful data is not waiting.
 */
const isAwaitingAvailability = (result: AvailabilityQueryResult) =>
  result.isPending ||
  result.isPlaceholderData ||
  (result.isError && result.isFetching);

/** The query's availability as the form reads it while the query debounces. */
const getAvailabilityState = (
  result: AvailabilityQueryResult,
  { isDebouncing, query }: ReturnType<typeof useDebouncedAvailabilityQuery>
) => ({
  availability: result.isError || isDebouncing ? null : (result.data ?? null),
  isFetching: result.isFetching || isDebouncing,
  // Debouncing also waits for a usable response; an empty query never does.
  isPending: isDebouncing || Boolean(query && isAwaitingAvailability(result)),
});

export function useReservationAvailability(
  query: WorkspaceAvailabilityQuery | undefined,
  options: UseReservationAvailabilityOptions = {}
) {
  const debounced = useDebouncedAvailabilityQuery(
    query,
    options.debounceMs ?? 0
  );
  const result = useQuery<WorkspaceAvailability>({
    ...(debounced.query
      ? getAvailabilityQueryOptions(debounced.query, options)
      : emptyAvailabilityQueryOptions),
    ...(options.keepPreviousData && { placeholderData: keepPreviousData }),
    retry: (failureCount) => failureCount < 3,
    staleTime: 30_000,
  });

  return { ...result, ...getAvailabilityState(result, debounced) };
}
