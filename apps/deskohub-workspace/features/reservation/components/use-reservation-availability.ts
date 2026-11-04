"use client";

import { hashKey, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type {
  PreloadedWorkspaceAvailability,
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

export function useReservationAvailability(
  query: WorkspaceAvailabilityQuery | undefined,
  options: UseReservationAvailabilityOptions = {}
): WorkspaceAvailabilityState {
  const debounced = useDebouncedAvailabilityQuery(
    query,
    options.debounceMs ?? 0
  );
  const availabilityQuery = debounced.query;
  const preloaded = availabilityQuery
    ? findPreloadedAvailability(options.initialAvailability, availabilityQuery)
    : undefined;
  const result = useQuery({
    ...workspaceAvailabilityQueryOptions({
      query: availabilityQuery,
      replacementToken: options.replacementToken,
    }),
    initialData: preloaded?.availability,
    initialDataUpdatedAt: preloaded?.loadedAt,
  });
  // The current query still waits for a usable response while it debounces,
  // loads, or retries after a failure (an errored query keeps its error
  // status while it refetches). A background refetch of successful data is
  // not pending, and an empty query never is.
  const isPending =
    debounced.isDebouncing ||
    Boolean(
      availabilityQuery &&
        (result.isPending || (result.isError && result.isFetching))
    );

  return {
    // Each query key has its own cache entry and no placeholder data, so
    // data is always the current query's.
    availability:
      result.isError || debounced.isDebouncing ? null : (result.data ?? null),
    isError: result.isError && !isPending,
    isPending,
  };
}
