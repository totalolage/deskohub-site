import { parseDotyposWebhookPayload } from "@deskohub/dotypos";
import { Data, Effect } from "effect";
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { env } from "@/env";
import { runWorkspaceRequestEffect } from "@/shared/backend/logging/censorship";
import { workspaceAvailabilityTags } from "@/shared/utils/cache-tags";

class DotyposWebhookAuthError extends Data.TaggedError(
  "DotyposWebhookAuthError"
)<{
  readonly message: string;
}> {}

class DotyposWebhookValidationError extends Data.TaggedError(
  "DotyposWebhookValidationError"
)<{
  readonly message: string;
  readonly issues?: unknown;
}> {}

const validateWebhookSecret = (url: URL) =>
  Effect.gen(function* () {
    if (env.VERCEL_ENV === "development") return;

    const providedSecret = url.searchParams.get("secret");
    const configuredSecret = env.DOTYPOS_WEBHOOK_SECRET;

    if (!providedSecret) {
      return yield* new DotyposWebhookAuthError({
        message: "Missing webhook secret",
      });
    }

    if (!configuredSecret) {
      return yield* new DotyposWebhookAuthError({
        message: "Webhook secret is not configured",
      });
    }

    if (providedSecret !== configuredSecret) {
      return yield* new DotyposWebhookAuthError({
        message: "Invalid webhook secret",
      });
    }
  });

const parseWebhookBody = (request: Request) =>
  Effect.tryPromise({
    try: () => request.json(),
    catch: () =>
      new DotyposWebhookValidationError({
        message: "Failed to parse request body",
      }),
  });

const decodeWebhookPayload = (payload: unknown) =>
  parseDotyposWebhookPayload(payload).pipe(
    Effect.mapError(
      (error) =>
        new DotyposWebhookValidationError({
          message: error.message,
          issues: error.issues,
        })
    )
  );

const processWebhookRequest = Effect.fn("processDotyposWebhookRequest")(
  function* (request: Request) {
    yield* Effect.logInfo("Dotypos webhook invoked");

    yield* validateWebhookSecret(new URL(request.url));
    const payload = yield* parseWebhookBody(request).pipe(
      Effect.flatMap(decodeWebhookPayload)
    );

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

    const tag = workspaceAvailabilityTags.all();
    yield* Effect.try({
      try: () => revalidateTag(tag, { expire: 0 }),
      catch: (cause) => cause,
    });

    yield* Effect.logInfo("Dotypos reservation webhook processed", {
      invalidatedTag: tag,
      recordCount: payload.records.length,
    });

    return NextResponse.json({
      success: true,
      invalidatedTag: tag,
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
        DotyposWebhookValidationError: (error: DotyposWebhookValidationError) =>
          Effect.succeed(
            NextResponse.json(
              {
                error: "Invalid payload",
                message: error.message,
                issues: error.issues ?? null,
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
