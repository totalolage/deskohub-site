import {
  DotyposWebhookAuthError,
  type DotyposWebhookPayloadError,
  verifyDotyposWebhookRequest,
} from "@deskohub/dotypos";
import { Effect } from "effect";
import { NextResponse } from "next/server";
import { env } from "@/env";
import { invalidateWorkspaceAvailabilityAdvisoryCache } from "@/features/reservation/backend/workspace-availability.service";
import { runWorkspaceRequestEffect } from "@/shared/backend/logging/censorship";

const getRequiredWebhookSecret = () =>
  Effect.gen(function* () {
    if (env.VERCEL_ENV === "development")
      return env.DOTYPOS_WEBHOOK_SECRET ?? "";
    if (env.DOTYPOS_WEBHOOK_SECRET) return env.DOTYPOS_WEBHOOK_SECRET;

    return yield* new DotyposWebhookAuthError({
      message: "Missing webhook secret configuration",
    });
  });

const processWebhookRequest = Effect.fn("processDotyposWebhookRequest")(
  function* (request: Request) {
    yield* Effect.logInfo("Dotypos webhook invoked");
    const secret = yield* getRequiredWebhookSecret();

    const payload = yield* verifyDotyposWebhookRequest(request, {
      requireSecret: env.VERCEL_ENV !== "development",
      secret,
    });

    if (payload.kind !== "reservation") {
      yield* Effect.logInfo("Dotypos webhook ignored", {
        payloadKind: payload.kind,
        recordCount: payload.records.length,
      });

      return NextResponse.json({
        success: true,
        ignored: true,
        payloadKind: payload.kind,
      });
    }

    yield* invalidateWorkspaceAvailabilityAdvisoryCache();

    yield* Effect.logInfo("Dotypos reservation webhook processed", {
      recordCount: payload.records.length,
    });

    return NextResponse.json({
      success: true,
      recordCount: payload.records.length,
    });
  },
  (effect) =>
    effect.pipe(
      Effect.scoped,
      Effect.annotateLogs({ method: "POST", operation: "dotyposWebhook" }),
      Effect.tapError((cause) =>
        Effect.logError("Dotypos webhook failed", { cause })
      ),
      Effect.catchTags({
        DotyposWebhookAuthError: (error: DotyposWebhookAuthError) =>
          Effect.succeed(
            NextResponse.json(
              { error: "Unauthorized", message: error.message },
              { status: 401 }
            )
          ),
        DotyposWebhookPayloadError: (error: DotyposWebhookPayloadError) =>
          Effect.succeed(
            NextResponse.json(
              {
                error: "Invalid payload",
                message: error.message,
              },
              { status: 400 }
            )
          ),
      }),
      Effect.catch(() =>
        Effect.succeed(
          NextResponse.json(
            { error: "Internal processing error" },
            { status: 500 }
          )
        )
      )
    )
);

export async function POST(request: Request): Promise<NextResponse> {
  return runWorkspaceRequestEffect(request, processWebhookRequest(request));
}

export async function GET() {
  return NextResponse.json({
    status: "ok",
    endpoint: "/api/webhooks/dotypos",
    accepts: "POST",
    payload: "Dotypos reservation change records",
  });
}
