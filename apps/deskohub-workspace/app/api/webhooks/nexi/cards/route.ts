import { decodeNexiWebhookNotification } from "@deskohub/nexi";
import { Effect, Layer, Result } from "effect";
import { NextResponse } from "next/server";
import { SavedCardService } from "@/features/account/backend/saved-card/saved-card.service";
import { WorkspaceNexiLayer } from "@/shared/backend/config/nexi.config";
import {
  defineWorkspaceRoute,
  WorkspaceRouteFailure,
} from "@/shared/backend/workspace-route";

const parseFailedResponse = NextResponse.json(
  {
    error: "Webhook processing failed",
    code: "nexi_cards_webhook_parse_failed",
  },
  { status: 400 }
);

/** Exposed for route-level tests; the POST handler is the only caller. */
export const processSavedCardWebhookRequest = Effect.fn(
  "processSavedCardWebhookRequest"
)(function* (request: Request) {
  // The parse failure lives in the error channel; route it to the fixed 400
  // parse-failed response instead of the outer internal-error 500.
  const parsed = yield* Effect.result(
    Effect.tryPromise({
      try: () => request.json() as Promise<unknown>,
      catch: () => "parse_failed" as const,
    })
  );
  if (Result.isFailure(parsed)) return parseFailedResponse;
  const payload = parsed.success;

  const decoded = yield* Effect.result(decodeNexiWebhookNotification(payload));
  if (Result.isFailure(decoded)) return parseFailedResponse;
  const envelope = decoded.success;

  // A notification without a security token cannot be authenticated: it is
  // ignored with zero mutations and zero provider calls.
  if (!envelope.securityToken) {
    yield* Effect.logWarning("Saved card webhook omitted its security token", {
      code: "nexi_cards_webhook_missing_security_token",
    });
    return NextResponse.json(
      {
        error: "Webhook processing failed",
        code: "nexi_cards_webhook_missing_security_token",
      },
      { status: 202 }
    );
  }

  const outcome = yield* Effect.flatMap(SavedCardService, (service) =>
    service.reconcileEnrollmentByOrderId(
      envelope.operation.orderId,
      envelope.securityToken
    )
  ).pipe(
    Effect.map((outcome) => ({ kind: "outcome" as const, outcome })),
    Effect.catchTag("SavedCardError", (error) =>
      Effect.succeed({ kind: "error" as const, code: error.code })
    )
  );

  if (outcome.kind === "error") {
    if (outcome.code === "unavailable") {
      // Retryable provider failures answer 500 so the provider retries the
      // notification once verification can actually run.
      yield* Effect.logWarning(
        "Saved card webhook verification unavailable; provider will retry",
        { code: "nexi_cards_webhook_verification_unavailable" }
      );
      return NextResponse.json(
        {
          error: "Webhook processing failed",
          code: "nexi_cards_webhook_verification_unavailable",
        },
        { status: 500 }
      );
    }
    return NextResponse.json({
      message: "Webhook received",
      status: "ignored",
    });
  }

  if (outcome.outcome === "not_found") {
    // Unknown orders and token mismatches are ignored, mirroring the payment
    // webhook's unknown-order convention.
    yield* Effect.logWarning(
      "Saved card webhook referenced nothing actionable",
      {
        code: "nexi_cards_webhook_unknown_order",
      }
    );
    return NextResponse.json(
      {
        error: "Webhook processing failed",
        code: "nexi_cards_webhook_unknown_order",
      },
      { status: 202 }
    );
  }

  yield* Effect.logInfo("Saved card webhook processed", {
    outcome: outcome.outcome,
  });
  return NextResponse.json({
    message: "Webhook received",
    status: "processed",
  });
});

/**
 * POST /api/webhooks/nexi/cards
 *
 * Receives Nexi saved-card enrollment notifications and verifies enrollment
 * server-side through SavedCardService.
 */
export const POST = defineWorkspaceRoute(
  {
    operation: "account.cardWebhook",
    cancellation: "continue-after-disconnect",
  },
  (request) =>
    processSavedCardWebhookRequest(request).pipe(
      Effect.catch((cause) =>
        Effect.logError("Saved card webhook route failed", { cause }).pipe(
          Effect.as(
            NextResponse.json(
              {
                error: "Webhook processing failed",
                code: "nexi_cards_webhook_internal_error",
              },
              { status: 500 }
            )
          )
        )
      ),
      Effect.provide(
        SavedCardService.Live.pipe(Layer.provide(WorkspaceNexiLayer))
      ),
      Effect.mapError(
        WorkspaceRouteFailure.internal("Saved card webhook processing failed")
      )
    )
);
