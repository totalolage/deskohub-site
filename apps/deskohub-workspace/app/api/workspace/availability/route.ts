import { Effect } from "effect";
import { NextResponse } from "next/server";
import {
  loadAvailability,
  WorkspaceAvailabilityLoaderLive,
} from "@/features/reservation/backend/workspace-availability-loader";
import { parseWorkspaceAvailabilityQuery } from "@/features/reservation/workspace-availability";
import { workspaceAvailabilityReplacementHeader } from "@/features/reservation/workspace-availability-request";
import { defineWorkspaceRoute } from "@/shared/backend/workspace-route";

const loadWorkspaceAvailabilityRequest = Effect.fn(
  "loadWorkspaceAvailabilityRequest"
)(function* (request: Request) {
  const query = parseWorkspaceAvailabilityQuery(
    new URL(request.url).searchParams
  );
  yield* Effect.annotateLogsScoped({ query });
  yield* Effect.logInfo("Workspace availability request parsed");

  return yield* loadAvailability({
    query,
    replacementToken:
      request.headers.get(workspaceAvailabilityReplacementHeader) ?? undefined,
  });
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
      Effect.catchTag("ValidationError", (error) =>
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
