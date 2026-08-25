import { Data, Effect } from "effect";
import { revalidateTag } from "next/cache";
import { env } from "@/env";
import { verifyOpeningHoursCalendarWebhookToken } from "@/features/opening-hours/backend/opening-hours-calendar-webhook-auth";
import { openingHoursTags } from "@/shared/utils/cache-tags";

const acceptedResourceStates = new Set(["exists", "not_exists"]);

class OpeningHoursCacheInvalidationError extends Data.TaggedError(
  "OpeningHoursCacheInvalidationError"
)<{
  readonly cause: unknown;
}> {}

export async function POST(request: Request): Promise<Response> {
  if (!env.CRON_SECRET) {
    return Response.json(
      { error: "Google Calendar webhook is not configured" },
      { status: 503 }
    );
  }

  const token = request.headers.get("x-goog-channel-token");
  if (
    !token ||
    !verifyOpeningHoursCalendarWebhookToken(token, env.CRON_SECRET)
  ) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const resourceState = request.headers.get("x-goog-resource-state");
  if (resourceState === "sync") {
    return new Response(null, { status: 204 });
  }

  if (!resourceState || !acceptedResourceStates.has(resourceState)) {
    return Response.json(
      { error: "Unsupported Google Calendar resource state" },
      { status: 400 }
    );
  }

  return Effect.runPromise(
    Effect.try({
      try: () => {
        revalidateTag(openingHoursTags.exceptions(), { expire: 0 });
        return new Response(null, { status: 204 });
      },
      catch: (cause) => new OpeningHoursCacheInvalidationError({ cause }),
    }).pipe(
      Effect.tapError((cause) =>
        Effect.logError("Google Calendar cache invalidation failed", { cause })
      ),
      Effect.orElseSucceed(() =>
        Response.json(
          { error: "Google Calendar cache invalidation failed" },
          { status: 500 }
        )
      ),
      Effect.annotateLogs({
        operation: "openingHoursCalendarWebhook",
        resourceState,
      })
    )
  );
}
