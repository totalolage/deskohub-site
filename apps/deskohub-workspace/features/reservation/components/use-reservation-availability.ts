"use client";

import { hashKey, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type {
  PreloadedWorkspaceAvailability,
  WorkspaceAvailability,
  WorkspaceAvailabilityQuery,
  WorkspaceAvailabilityState,
} from "@/features/reservation/workspace-availability";
import { workspaceAvailabilityQueryOptions } from "@/features/reservation/workspace-availability-client";

type UseReservationAvailabilityOptions = {
  readonly debounceMs?: number;
  /** Server-loaded availability, used only for a query it was loaded for. */
  readonly initialAvailability?: ReadonlyArray<PreloadedWorkspaceAvailability>;
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

type AvailabilityQueryResult = {
  readonly data?: WorkspaceAvailability;
  readonly isError: boolean;
  readonly isFetching: boolean;
  readonly isPending: boolean;
};

/**
 * Whether the query still waits for a usable response: loading, or retrying
 * after a failure (an errored query keeps its error status while it
 * refetches). A background refetch of successful data is not waiting.
 */
const isAwaitingAvailability = (result: AvailabilityQueryResult) =>
  result.isPending || (result.isError && result.isFetching);

/** The query's availability as the form reads it while the query debounces. */
const getAvailabilityState = (
  result: AvailabilityQueryResult,
  { isDebouncing, query }: ReturnType<typeof useDebouncedAvailabilityQuery>
): WorkspaceAvailabilityState => {
  // Debouncing also waits for a usable response; an empty query never does.
  const isPending =
    isDebouncing || Boolean(query && isAwaitingAvailability(result));

  return {
    // Each query key has its own cache entry and no placeholder data, so
    // data is always the current query's.
    availability: result.isError || isDebouncing ? null : (result.data ?? null),
    isError: result.isError && !isPending,
    isPending,
  };
};

export function useReservationAvailability(
  query: WorkspaceAvailabilityQuery | undefined,
  options: UseReservationAvailabilityOptions = {}
): WorkspaceAvailabilityState {
  const debounced = useDebouncedAvailabilityQuery(
    query,
    options.debounceMs ?? 0
  );
  const preloaded =
    debounced.query &&
    findPreloadedAvailability(options.initialAvailability, debounced.query);
  const result = useQuery({
    ...workspaceAvailabilityQueryOptions({
      query: debounced.query,
      replacementToken: options.replacementToken,
    }),
    initialData: preloaded?.availability,
    initialDataUpdatedAt: preloaded?.loadedAt,
  });

  return getAvailabilityState(result, debounced);
}
