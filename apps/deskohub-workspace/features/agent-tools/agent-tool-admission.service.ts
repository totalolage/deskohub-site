import { checkRateLimit } from "@vercel/firewall";
import { Context, Data, Effect, Layer } from "effect";

/**
 * The Vercel Firewall rate-limit rule that bounds tool calls per client IP.
 * The Workspace Vercel project defines it.
 */
const agentToolCallRateLimitId = "agent-tool-call";

interface IAgentToolAdmission {
  /**
   * Whether the client behind these request headers may call a tool now.
   * Fails when the rate limit can't be checked.
   */
  readonly isCallAllowed: (
    headers: Headers
  ) => Effect.Effect<boolean, AgentToolAdmissionError>;
}

export class AgentToolAdmission extends Context.Service<
  AgentToolAdmission,
  IAgentToolAdmission
>()("@deskohub-workspace/agent-tools/AgentToolAdmission") {
  /**
   * Admits calls the rule allows. A missing rule or an unreachable firewall
   * fails closed, as CLI authentication admission does, so tools never run
   * without the per-IP limit.
   */
  static Default = Layer.succeed(this, {
    isCallAllowed: (headers) =>
      Effect.tryPromise({
        try: () => checkRateLimit(agentToolCallRateLimitId, { headers }),
        catch: (cause) =>
          new AgentToolAdmissionError({ reason: "check-failed", cause }),
      }).pipe(
        Effect.filterOrFail(
          ({ error }) => error !== "not-found",
          () => new AgentToolAdmissionError({ reason: "rule-missing" })
        ),
        Effect.map(
          ({ error, rateLimited }) => !rateLimited && error !== "blocked"
        ),
        Effect.tapError((error) =>
          Effect.logError("Agent tool rate limit could not be checked", {
            rateLimitId: agentToolCallRateLimitId,
            reason: error.reason,
            cause: error.cause,
          })
        ),
        Effect.withSpan("AgentToolAdmission.isCallAllowed")
      ),
  });
}

/** Why the rate limit couldn't be checked; the call is denied. */
class AgentToolAdmissionError extends Data.TaggedError(
  "AgentToolAdmissionError"
)<{
  /** `rule-missing`: the project has no rule with the rate-limit ID. */
  readonly reason: "rule-missing" | "check-failed";
  readonly cause?: unknown;
}> {}
