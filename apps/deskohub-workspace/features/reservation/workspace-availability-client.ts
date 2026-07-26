import { Match } from "effect";
import {
  parseWorkspaceAvailabilityResponse,
  type WorkspaceAvailability,
  type WorkspaceAvailabilityQuery,
} from "@/features/reservation/workspace-availability";

export const getWorkspaceAvailabilityUrl = (
  query: WorkspaceAvailabilityQuery
) => {
  const params = new URLSearchParams({
    kind: query.kind,
    from: query.from,
    to: query.to,
  });

  Match.value(query).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: ({ date, entryTier, monitorOption }) => {
        if (date) params.set("date", date);
        if (entryTier) params.set("entryTier", entryTier);
        if (monitorOption) params.set("monitorOption", monitorOption);
      },
      "meeting-room": ({ startsAt, endsAt }) => {
        if (startsAt) params.set("startsAt", startsAt);
        if (endsAt) params.set("endsAt", endsAt);
      },
    })
  );

  return `/api/workspace/availability?${params.toString()}`;
};

export const loadWorkspaceAvailability = async ({
  query,
  signal,
}: {
  readonly query: WorkspaceAvailabilityQuery;
  readonly signal: AbortSignal;
}): Promise<WorkspaceAvailability> => {
  const response = await fetch(getWorkspaceAvailabilityUrl(query), { signal });
  if (!response.ok) throw new Error("Availability request failed");

  return parseWorkspaceAvailabilityResponse(await response.json());
};
