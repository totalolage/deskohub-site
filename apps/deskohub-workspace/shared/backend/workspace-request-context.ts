import { Context, Effect } from "effect";
import {
  type AgentTraffic,
  classifyAgentTraffic,
  unclassifiedTraffic,
} from "@/shared/agent-traffic/agent-traffic";
import {
  CurrentPostHogRequestContext,
  getPostHogRequestContextFromRequestHeadersWithDiagnostics,
  logUnexpectedConsentCookieReasons,
} from "./analytics/posthog-request-context";
import { getPostHogLogAnnotationsFromCookieValues } from "./logging/posthog-log-annotations";

export const CurrentWorkspaceRequestHeaders = Context.Reference(
  "@deskohub-workspace/CurrentWorkspaceRequestHeaders",
  { defaultValue: (): Headers | undefined => undefined }
);

/**
 * The agent category of the request being served. Work that serves no
 * customer request, such as a task, a cron run, or a webhook, counts as
 * unclassified.
 */
export const CurrentAgentTraffic = Context.Reference(
  "@deskohub-workspace/CurrentAgentTraffic",
  { defaultValue: (): AgentTraffic => unclassifiedTraffic }
);

/**
 * Provides the request's context. The agent category comes from the
 * request's own `User-Agent` and `Signature-Agent` headers unless the caller
 * supplies one.
 */
export const withWorkspaceRequestContext = (
  headers: Headers,
  agentTraffic: AgentTraffic = classifyAgentTraffic(headers)
) =>
  function provideWorkspaceRequestContext<A, E, R>(
    effect: Effect.Effect<A, E, R>
  ) {
    return Effect.sync(() =>
      getPostHogRequestContextFromRequestHeadersWithDiagnostics(headers)
    ).pipe(
      Effect.flatMap(({ context, unexpectedConsentCookieReasons }) =>
        Effect.andThen(
          logUnexpectedConsentCookieReasons(unexpectedConsentCookieReasons),
          effect
        ).pipe(
          Effect.annotateLogs(
            getPostHogLogAnnotationsFromCookieValues(context)
          ),
          Effect.provideService(CurrentPostHogRequestContext, context),
          Effect.provideService(CurrentWorkspaceRequestHeaders, headers),
          Effect.provideService(CurrentAgentTraffic, agentTraffic)
        )
      )
    );
  };
