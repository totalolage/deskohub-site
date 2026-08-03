import { randomUUID } from "node:crypto";
import { Data, Effect } from "effect";
import { revalidateTag } from "next/cache";
import { env } from "@/env";
import { OpeningHoursCalendarService } from "@/features/opening-hours/backend/opening-hours-calendar.service";
import { isOpeningHoursCalendarMaintenanceTime } from "@/features/opening-hours/backend/opening-hours-calendar-maintenance";
import { deriveOpeningHoursCalendarWebhookToken } from "@/features/opening-hours/backend/opening-hours-calendar-webhook-auth";
import { openingHoursTags } from "@/shared/utils/cache-tags";
import { siteConstants } from "@/shared/utils/constants";

const watchTtlSeconds = 3 * 24 * 60 * 60;
const webhookUrl = `https://${siteConstants.brand.publicDomain}/api/webhooks/google-calendar/opening-hours`;

class OpeningHoursCacheInvalidationError extends Data.TaggedError(
  "OpeningHoursCacheInvalidationError"
)<{
  readonly cause: unknown;
}> {}

const isAuthorizedCronRequest = (request: Request, cronSecret: string) =>
  request.headers.get("authorization") === `Bearer ${cronSecret}`;

export async function GET(request: Request): Promise<Response> {
  const cronSecret = env.CRON_SECRET;
  if (!cronSecret) {
    return Response.json(
      { error: "Opening-hours maintenance is not configured" },
      { status: 503 }
    );
  }

  if (!isAuthorizedCronRequest(request, cronSecret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const force = new URL(request.url).searchParams.get("force") === "1";
  if (
    !force &&
    !isOpeningHoursCalendarMaintenanceTime(Temporal.Now.instant())
  ) {
    return Response.json({ skipped: true });
  }

  const maintainOpeningHours = Effect.gen(function* () {
    const openingHoursCalendar = yield* OpeningHoursCalendarService;

    const channel = yield* openingHoursCalendar.watchChanges({
      channelId: randomUUID(),
      webhookToken: deriveOpeningHoursCalendarWebhookToken(cronSecret),
      webhookUrl,
      ttlSeconds: watchTtlSeconds,
    });

    yield* Effect.try({
      try: () => revalidateTag(openingHoursTags.exceptions(), { expire: 0 }),
      catch: (cause) => new OpeningHoursCacheInvalidationError({ cause }),
    });

    yield* Effect.logInfo("Opening-hours midnight maintenance completed", {
      channelId: channel.channelId,
      expiration: channel.expiration,
    });

    return Response.json({
      maintained: true,
      channelId: channel.channelId,
      ...(channel.expiration && { expiration: channel.expiration }),
    });
  }).pipe(
    Effect.provide(OpeningHoursCalendarService.LiveWithDependencies),
    Effect.tapError((cause) =>
      Effect.logError("Opening-hours midnight maintenance failed", { cause })
    ),
    Effect.orElseSucceed(() =>
      Response.json(
        { error: "Opening-hours maintenance failed" },
        { status: 500 }
      )
    ),
    Effect.annotateLogs({ operation: "openingHoursMidnightMaintenance" })
  );

  return Effect.runPromise(maintainOpeningHours);
}
