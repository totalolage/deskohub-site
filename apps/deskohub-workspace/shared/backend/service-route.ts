import "server-only";

import { isMatchingSecret } from "@deskohub/secret-comparison";
import { Data, Effect } from "effect";
import { NextResponse } from "next/server";
import { env } from "@/env";
import { defineWorkspaceRoute, WorkspaceRouteFailure } from "./workspace-route";

/**
 * A route a service calls, such as Vercel Cron or a provider webhook. Its
 * work serves no customer request and must finish without the caller.
 */
const defineServiceRoute = <A extends Response>(
  operation: string,
  handler: (request: Request) => Effect.Effect<A, WorkspaceRouteFailure>
) =>
  defineWorkspaceRoute(
    {
      operation,
      cancellation: "continue-after-disconnect",
      caller: "service",
    },
    handler
  );

interface WorkspaceCronJobOptions {
  /** Stable, low-cardinality name without IDs, URLs, or payload data. */
  readonly operation: string;
  /** Public error of the 500 response when the job fails. */
  readonly failureMessage: string;
}

/**
 * One Vercel Cron job. `input` builds the run's input, such as the current
 * time and batch limit, which the start and finish logs record; `run` returns
 * the summary the response carries.
 */
type WorkspaceCronJob<Input, Summary, E> = WorkspaceCronJobOptions &
  (
    | {
        readonly input: () => Input;
        readonly run: (input: Input) => Effect.Effect<Summary, E>;
      }
    | {
        readonly input?: never;
        readonly run: () => Effect.Effect<Summary, E>;
      }
  );

/**
 * Vercel Cron authorization: requests must carry the deployed cron secret.
 * Development runs stay authorized without the secret so local cron paths
 * remain exercisable.
 */
const isAuthorizedCronRequest = (request: Request) => {
  if (!env.CRON_SECRET) return env.VERCEL_ENV === "development";

  const authorization = request.headers.get("authorization");
  return (
    authorization !== null &&
    isMatchingSecret(authorization, `Bearer ${env.CRON_SECRET}`)
  );
};

/**
 * Defines a Vercel Cron route. It answers 401 to a request without the cron
 * secret, logs the job's start and finish with its input and summary, answers
 * the summary as JSON, and turns a job failure into a 500 with
 * `failureMessage`.
 */
export const defineWorkspaceCron = <Input, Summary, E>(
  job: WorkspaceCronJob<Input, Summary, E>
) =>
  defineServiceRoute(job.operation, (request) => {
    if (!isAuthorizedCronRequest(request)) {
      return Effect.fail(
        new WorkspaceRouteFailure({
          statusCode: 401,
          publicMessage: "Unauthorized",
        })
      );
    }

    return Effect.gen(function* () {
      if (job.input) {
        const input = job.input();
        yield* Effect.annotateLogsScoped({ input });
        yield* Effect.logInfo("Cron job started");
        return yield* job.run(input);
      }

      yield* Effect.logInfo("Cron job started");
      return yield* job.run();
    }).pipe(
      Effect.tap((result) => Effect.annotateLogsScoped({ result })),
      Effect.tap(() => Effect.logInfo("Cron job completed")),
      Effect.map((result) => NextResponse.json(result)),
      Effect.scoped,
      Effect.mapError(WorkspaceRouteFailure.internal(job.failureMessage))
    );
  });

type WebhookFailureSeverity = "warning" | "error" | "fatal";

/**
 * How a provider should treat a webhook delivery that was not processed, in
 * the terms providers act on. Each provider classifies its own failures in a
 * table beside its service.
 */
export type WebhookDisposition =
  /** Understood and dropped: 202, so the provider stops retrying. */
  | { readonly kind: "declined"; readonly severity: WebhookFailureSeverity }
  /** Malformed (400) or unauthenticated (401). */
  | {
      readonly kind: "rejected";
      readonly status: 400 | 401;
      readonly severity: WebhookFailureSeverity;
    }
  /** Not processed yet: 500, so the provider delivers it again. */
  | { readonly kind: "retry"; readonly severity: "error" | "fatal" };

/** A webhook delivery that ends with its disposition instead of a receipt. */
export class WebhookRefusal extends Data.TaggedError("WebhookRefusal")<{
  readonly disposition: WebhookDisposition;
  /** The response's public `error`; defaults to "Webhook processing failed". */
  readonly publicMessage?: string;
  /** A stable code for the response and logs, when the provider has one. */
  readonly code?: string;
  /** A public detail the response carries as `message`. */
  readonly publicDetail?: string;
  /** Delivery identifiers for the logs, never payload data. */
  readonly details?: Readonly<Record<string, string | undefined>>;
  readonly cause?: unknown;
}> {}

/**
 * What the response to a processed delivery reports beside its message. Any
 * other field of the handler's result stays out of the response.
 */
interface WebhookReceipt {
  readonly status?: string;
  readonly reason?: string;
}

interface WebhookRouteOptions {
  /** Stable, low-cardinality name without IDs, URLs, or payload data. */
  readonly operation: string;
  /** Public error of the 500 response for a failure no provider classified. */
  readonly failureMessage: string;
}

/** The HTTP status a refused delivery answers with. */
const webhookResponseStatus = (disposition: WebhookDisposition) => {
  switch (disposition.kind) {
    case "declined":
      return 202;
    case "rejected":
      return disposition.status;
    case "retry":
      return 500;
  }
};

const logAtSeverity = {
  warning: Effect.logWarning,
  error: Effect.logError,
  fatal: Effect.logFatal,
} satisfies Record<
  WebhookFailureSeverity,
  (...message: readonly unknown[]) => Effect.Effect<void>
>;

const respondToRefusal = Effect.fn("webhookRoute.respondToRefusal")(function* (
  refusal: WebhookRefusal
) {
  const { disposition, code, details, cause } = refusal;
  const identifiers = {
    ...(code !== undefined && { errorCode: code }),
    ...details,
  };

  yield* logAtSeverity[disposition.severity]("Webhook processing failed", {
    ...identifiers,
    ...(cause !== undefined && { cause }),
  });
  if (disposition.kind === "retry") {
    yield* Effect.logWarning(
      "Webhook response will trigger provider retry",
      identifiers
    );
  }

  // JSON drops the fields a refusal leaves undefined.
  return NextResponse.json(
    {
      error: refusal.publicMessage ?? "Webhook processing failed",
      code,
      message: refusal.publicDetail,
    },
    { status: webhookResponseStatus(disposition) }
  );
});

/**
 * Defines a provider webhook route. A receipt answers 200 with "Webhook
 * received"; a `WebhookRefusal` answers with its disposition's status, logs at
 * its severity, and warns when the provider will retry. Any other failure
 * becomes a 500 with `failureMessage`.
 */
export const defineWebhookRoute = <E>(
  options: WebhookRouteOptions,
  handle: (
    request: Request
  ) => Effect.Effect<WebhookReceipt, WebhookRefusal | E>
) =>
  defineServiceRoute(options.operation, (request) =>
    handle(request).pipe(
      Effect.map((receipt) =>
        NextResponse.json({
          message: "Webhook received",
          status: receipt.status,
          reason: receipt.reason,
        })
      ),
      Effect.catchIf(
        (error): error is WebhookRefusal => error instanceof WebhookRefusal,
        respondToRefusal
      ),
      Effect.mapError(WorkspaceRouteFailure.internal(options.failureMessage))
    )
  );
