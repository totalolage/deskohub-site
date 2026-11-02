import { Context, Effect, Option } from "effect";
import {
  type AgentTraffic,
  classifyAgentTraffic,
  unclassifiedTraffic,
} from "@/shared/agent-traffic/agent-traffic";
import {
  anonymousVisitor,
  readVisitorIdentity,
  type VisitorIdentity,
} from "./analytics/visitor-identity";
import { getRequestHeaders } from "./utils/request-headers";

export const CurrentWorkspaceRequestHeaders = Context.Reference(
  "@deskohub-workspace/CurrentWorkspaceRequestHeaders",
  { defaultValue: (): Headers | undefined => undefined }
);

/**
 * The headers of the request being served: those its action, route, or proxy
 * boundary captured, else Next's request store, read only when asked so a
 * cacheable page stays static until something needs the request. Next.js
 * control flow, such as a prerender bailout, propagates unchanged; a run
 * outside any request, such as a task or cron run, fails with
 * `RequestHeadersError`.
 */
export const currentRequestHeaders = Effect.flatMap(
  CurrentWorkspaceRequestHeaders,
  (captured) => (captured ? Effect.succeed(captured) : getRequestHeaders)
);

/**
 * The visitor identity a boundary resolved for its run: none when the run's
 * boundary resolved none, as a page leaves it, and the anonymous visitor for
 * work that serves no visitor.
 */
export const CurrentVisitorIdentity = Context.Reference(
  "@deskohub-workspace/CurrentVisitorIdentity",
  { defaultValue: (): Option.Option<VisitorIdentity> => Option.none() }
);

/**
 * The consented visitor of the request being served, resolved by its
 * boundary or else read from {@link currentRequestHeaders}. Fails with
 * `RequestHeadersError` when the run serves no request.
 */
export const currentVisitorIdentity = Effect.flatMap(
  CurrentVisitorIdentity,
  Option.match({
    onSome: Effect.succeed,
    onNone: () => Effect.flatMap(currentRequestHeaders, readVisitorIdentity),
  })
);

/**
 * Runs `effect` as work that serves no visitor, such as a task or work after
 * the response, so it never reads a visitor from Next's request store.
 */
export const withAnonymousVisitor = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.provideService(CurrentVisitorIdentity, Option.some(anonymousVisitor))
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
    return Effect.flatMap(readVisitorIdentity(headers), (visitor) =>
      effect.pipe(
        Effect.annotateLogs({
          posthogDistinctId: visitor.distinctId,
          sessionId: visitor.sessionId,
        }),
        Effect.provideService(CurrentVisitorIdentity, Option.some(visitor)),
        Effect.provideService(CurrentWorkspaceRequestHeaders, headers),
        Effect.provideService(CurrentAgentTraffic, agentTraffic)
      )
    );
  };
