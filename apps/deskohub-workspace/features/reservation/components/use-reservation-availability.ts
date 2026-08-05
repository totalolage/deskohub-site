"use client";

import { keepPreviousData, skipToken, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  type WorkspaceAvailability,
  type WorkspaceAvailabilityQuery,
  workspaceAvailabilityKeys,
} from "@/features/reservation/workspace-availability";
import { loadWorkspaceAvailability } from "@/features/reservation/workspace-availability-client";

type UseReservationAvailabilityOptions = {
  readonly debounceMs?: number;
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

export function useReservationAvailability(
  query: WorkspaceAvailabilityQuery | undefined,
  options: UseReservationAvailabilityOptions = {}
) {
  const debounced = useDebouncedAvailabilityQuery(
    query,
    options.debounceMs ?? 0
  );
  const availabilityQuery = debounced.query;
  const result = useQuery<WorkspaceAvailability>({
    queryKey: availabilityQuery
      ? [
          ...workspaceAvailabilityKeys.availability(availabilityQuery),
          options.replacementToken ?? null,
        ]
      : ["workspace-availability", "empty"],
    queryFn: availabilityQuery
      ? ({ signal }) =>
          loadWorkspaceAvailability({
            query: availabilityQuery,
            signal,
            replacementToken: options.replacementToken,
          })
      : skipToken,
    ...(options.keepPreviousData && { placeholderData: keepPreviousData }),
    retry: (failureCount) => failureCount < 3,
    staleTime: 30_000,
  });

  return {
    ...result,
    availability:
      result.isError || debounced.isDebouncing ? null : (result.data ?? null),
    isFetching: result.isFetching || debounced.isDebouncing,
  };
}
