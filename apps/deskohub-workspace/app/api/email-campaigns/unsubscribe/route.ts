import { Effect, Match } from "effect";
import { NextResponse } from "next/server";
import { CampaignUnsubscribeService } from "@/features/email-campaigns/backend/campaign-unsubscribe.service";
import {
  defineWorkspaceRoute,
  WorkspaceRouteFailure,
} from "@/shared/backend/workspace-route";

const invalidLink = () =>
  new WorkspaceRouteFailure({
    statusCode: 400,
    publicMessage: "This unsubscribe link is invalid.",
  });

const linkToken = (request: Request) =>
  new URL(request.url).searchParams.get("token") ?? "";

/**
 * POST /api/email-campaigns/unsubscribe?token=…
 *
 * RFC 8058 one-click unsubscribe: a mail client posts
 * `List-Unsubscribe=One-Click` here, and the recipient's marketing consent is
 * withdrawn. Repeating the request succeeds without changing anything.
 */
export const POST = defineWorkspaceRoute(
  {
    operation: "emailCampaignUnsubscribe",
    cancellation: "continue-after-disconnect",
    caller: "client",
  },
  (request) =>
    CampaignUnsubscribeService.pipe(
      Effect.flatMap((unsubscribe) =>
        unsubscribe.unsubscribe(linkToken(request))
      ),
      Effect.tap((outcome) =>
        Effect.logInfo("Campaign unsubscribe processed", { outcome })
      ),
      Effect.as(NextResponse.json({ status: "unsubscribed" })),
      Effect.provide(CampaignUnsubscribeService.Live),
      Effect.mapError((error) =>
        Match.value(error).pipe(
          Match.tag("CampaignUnsubscribeTokenInvalid", invalidLink),
          Match.orElse(
            WorkspaceRouteFailure.internal(
              "Unsubscribe could not be processed."
            )
          )
        )
      )
    )
);

/**
 * GET /api/email-campaigns/unsubscribe?token=…
 *
 * Opening the link (the email footer, or a client that only follows it)
 * never unsubscribes; it opens the recipient's marketing preferences.
 */
export const GET = defineWorkspaceRoute(
  {
    operation: "emailCampaignPreferences",
    cancellation: "interrupt-on-disconnect",
    caller: "client",
  },
  (request) =>
    CampaignUnsubscribeService.pipe(
      Effect.flatMap((unsubscribe) =>
        unsubscribe.preferencesUrl(linkToken(request))
      ),
      Effect.map((url) => NextResponse.redirect(url, 303)),
      Effect.provide(CampaignUnsubscribeService.Live),
      Effect.mapError((error) =>
        Match.value(error).pipe(
          Match.tag("CampaignUnsubscribeTokenInvalid", invalidLink),
          Match.orElse(
            WorkspaceRouteFailure.internal(
              "Marketing preferences could not be opened."
            )
          )
        )
      )
    )
);
