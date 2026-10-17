import { checkRateLimit } from "@vercel/firewall";
import { Context, Data, Effect, Layer } from "effect";

/**
 * The Vercel Firewall rate-limit rule that bounds tool calls per client IP.
 * The Workspace Vercel project defines it.
 */
const agentToolCallRateLimitId = "agent-tool-call";

interface IAgentToolAdmission {
  /** Whether the client behind these request headers may call a tool now. */
  readonly isCallAllowed: (headers: Headers) => Effect.Effect<boolean>;
}

export class AgentToolAdmission extends Context.Service<
  AgentToolAdmission,
  IAgentToolAdmission
>()("@deskohub-workspace/agent-tools/AgentToolAdmission") {
  /**
   * Admits calls the rule allows. Tools only read public data from shared
   * caches, so a missing rule or an unreachable firewall admits the call and
   * logs instead of taking every tool down.
   */
  static Default = Layer.succeed(this, {
    isCallAllowed: (headers) =>
      Effect.tryPromise({
        try: () => checkRateLimit(agentToolCallRateLimitId, { headers }),
        catch: (cause) => new AgentToolAdmissionError({ cause }),
      }).pipe(
        Effect.flatMap(({ error, rateLimited }) =>
          error === "not-found"
            ? Effect.logError(
                "Agent tool rate-limit rule is missing; the call is admitted",
                { rateLimitId: agentToolCallRateLimitId }
              ).pipe(Effect.as(true))
            : Effect.succeed(!rateLimited && error !== "blocked")
        ),
        Effect.catchTag("AgentToolAdmissionError", (error) =>
          Effect.logWarning(
            "Agent tool rate limit could not be checked; the call is admitted",
            { cause: error.cause }
          ).pipe(Effect.as(true))
        ),
        Effect.withSpan("AgentToolAdmission.isCallAllowed")
      ),
  });
}

class AgentToolAdmissionError extends Data.TaggedError(
  "AgentToolAdmissionError"
)<{ readonly cause: unknown }> {}
