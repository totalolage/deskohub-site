import { Match } from "effect";
import {
  type MeetingRoomStartTimes,
  type MeetingRoomStartTimesQuery,
  parseMeetingRoomStartTimesResponse,
  parseWorkspaceAvailabilityResponse,
  type WorkspaceAvailability,
  type WorkspaceAvailabilityQuery,
} from "@/features/reservation/workspace-availability";
import {
  type WorkspaceAvailabilityClientRequest,
  workspaceAvailabilityReplacementHeader,
} from "@/features/reservation/workspace-availability-request";

export { workspaceAvailabilityReplacementHeader };

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
      office: ({ endsAt, seats, startsAt }) => {
        if (startsAt) params.set("startsAt", startsAt);
        if (endsAt) params.set("endsAt", endsAt);
        if (seats) params.set("seats", String(seats));
      },
    })
  );

  return `/api/workspace/availability?${params.toString()}`;
};

export const getMeetingRoomStartTimesUrl = (
  query: MeetingRoomStartTimesQuery
) => `/api/workspace/availability?${new URLSearchParams(query).toString()}`;

const fetchAvailability = async ({
  replacementToken,
  signal,
  url,
}: {
  readonly replacementToken?: string;
  readonly signal: AbortSignal;
  readonly url: string;
}) => {
  const response = await fetch(url, {
    signal,
    ...(replacementToken && {
      headers: {
        [workspaceAvailabilityReplacementHeader]: replacementToken,
      },
    }),
  });
  if (!response.ok) throw new Error("Availability request failed");

  return response.json();
};

export const loadWorkspaceAvailability = async ({
  query,
  replacementToken,
  signal,
}: WorkspaceAvailabilityClientRequest & {
  readonly signal: AbortSignal;
}): Promise<WorkspaceAvailability> =>
  parseWorkspaceAvailabilityResponse(
    await fetchAvailability({
      replacementToken,
      signal,
      url: getWorkspaceAvailabilityUrl(query),
    })
  );

export const loadMeetingRoomStartTimes = async ({
  query,
  replacementToken,
  signal,
}: {
  readonly query: MeetingRoomStartTimesQuery;
  readonly replacementToken?: string;
  readonly signal: AbortSignal;
}): Promise<MeetingRoomStartTimes> =>
  parseMeetingRoomStartTimesResponse(
    await fetchAvailability({
      replacementToken,
      signal,
      url: getMeetingRoomStartTimesUrl(query),
    })
  );
