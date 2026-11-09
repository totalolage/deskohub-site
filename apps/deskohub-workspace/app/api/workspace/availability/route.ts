import { Effect, Option } from "effect";
import { NextResponse } from "next/server";
import { AvailabilityQueryInvalid } from "@/features/reservation/backend/workspace-availability.service";
import {
  loadAvailability,
  loadMeetingRoomStartTimes,
  WorkspaceAvailabilityLoaderLive,
} from "@/features/reservation/backend/workspace-availability-loader";
import {
  isMeetingRoomStartTimesRequest,
  parseMeetingRoomStartTimesQuery,
  parseWorkspaceAvailabilityQuery,
} from "@/features/reservation/workspace-availability";
import { workspaceAvailabilityReplacementHeader } from "@/features/reservation/workspace-availability-request";
import { defineWorkspaceRoute } from "@/shared/backend/workspace-route";

const loadWorkspaceAvailabilityRequest = Effect.fn(
  "loadWorkspaceAvailabilityRequest"
)(function* (request: Request) {
  const { searchParams } = new URL(request.url);
  const replacementToken =
    request.headers.get(workspaceAvailabilityReplacementHeader) ?? undefined;

  if (isMeetingRoomStartTimesRequest(searchParams)) {
    const query = yield* Option.match(
      parseMeetingRoomStartTimesQuery(searchParams),
      {
        onNone: () =>
          Effect.fail(
            new AvailabilityQueryInvalid({
              message:
                "Meeting-room start times need kind=meeting-room, a YYYY-MM-DD date, and a duration of hour:1, hour:4, or day:1.",
            })
          ),
        onSome: Effect.succeed,
      }
    );
    yield* Effect.annotateLogsScoped({ query });
    yield* Effect.logInfo("Meeting-room start times request parsed");

    return yield* loadMeetingRoomStartTimes({ query, replacementToken });
  }

  const query = yield* Option.match(
    parseWorkspaceAvailabilityQuery(searchParams),
    {
      onNone: () =>
        Effect.fail(
          new AvailabilityQueryInvalid({
            message:
              "Meeting-room availability needs startsAt and endsAt of one meeting-room booking of 1 hour, 4 hours, or a whole day.",
          })
        ),
      onSome: Effect.succeed,
    }
  );
  yield* Effect.annotateLogsScoped({ query });
  yield* Effect.logInfo("Workspace availability request parsed");

  return yield* loadAvailability({ query, replacementToken });
}, Effect.scoped);

export const GET = defineWorkspaceRoute(
  {
    operation: "workspaceAvailability",
    cancellation: "interrupt-on-disconnect",
    caller: "client",
  },
  (request) =>
    loadWorkspaceAvailabilityRequest(request).pipe(
      Effect.tap((result) =>
        Effect.logInfo("Workspace availability response ready", { result })
      ),
      Effect.map((result) =>
        NextResponse.json(result, {
          headers: { "Cache-Control": "private, no-store" },
        })
      ),
      Effect.provide(WorkspaceAvailabilityLoaderLive),
      Effect.catchTag("AvailabilityQueryInvalid", (error) =>
        Effect.succeed(
          NextResponse.json({ error: error.message }, { status: 400 })
        )
      ),
      Effect.catch(
        Effect.fn("handleAvailabilityRouteError")(function* (cause) {
          yield* Effect.logError("Workspace availability route failed", {
            cause,
          });

          return NextResponse.json(
            { error: "Workspace availability could not be loaded" },
            { status: 500 }
          );
        })
      )
    )
);
