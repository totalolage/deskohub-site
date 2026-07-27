"use client";

import { keepPreviousData, skipToken, useQuery } from "@tanstack/react-query";
import {
  type WorkspaceAvailability,
  type WorkspaceAvailabilityQuery,
  workspaceAvailabilityKeys,
} from "@/features/reservation/workspace-availability";
import { loadWorkspaceAvailability } from "@/features/reservation/workspace-availability-client";

type UseReservationAvailabilityOptions = {
  readonly keepPreviousData?: boolean;
};

export function useReservationAvailability(
  query: WorkspaceAvailabilityQuery | undefined,
  options: UseReservationAvailabilityOptions = {}
) {
  const result = useQuery<WorkspaceAvailability>({
    queryKey: query
      ? workspaceAvailabilityKeys.availability(query)
      : ["workspace-availability", "empty"],
    queryFn: query
      ? ({ signal }) => loadWorkspaceAvailability({ query, signal })
      : skipToken,
    ...(options.keepPreviousData && { placeholderData: keepPreviousData }),
    retry: (failureCount) => failureCount < 3,
    staleTime: 30_000,
  });

  return {
    ...result,
    availability: result.isError ? null : (result.data ?? null),
  };
}
