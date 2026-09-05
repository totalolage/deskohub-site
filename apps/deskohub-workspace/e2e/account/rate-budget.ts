import { Effect } from "effect";
import { betterAuthMagicLinkOptions } from "@/features/account/backend/auth/auth-options";

/**
 * The deployed Better Auth magic-link endpoints rate limit each client IP and
 * path with `{count, lastRequest}` state: the first request creates count 1,
 * every allowed request below the maximum increments the count and advances
 * `lastRequest`, a blocked request at the maximum advances nothing, and the
 * count resets to 1 only once a full quiet window has passed since the last
 * allowed request. All account cases in a run share the runner's egress IP,
 * so the serial account lane wraps every send or verification through the
 * same state machine here. The budget stays one request below the deployed
 * ceiling so concurrent browser traffic can never trip the real limiter.
 *
 * `run` checks readiness by producing an immutable admission value: nothing
 * is admitted while the quiet window still holds at capacity, otherwise the
 * admission captures `nextCount` from the state at admission time. The
 * supplied Effect then runs, and the finalizer writes
 * `{count: admission.nextCount, lastRequest: now()}` once it completes,
 * including on failure or interruption. `lastRequest` is the completion time
 * rather than request receipt, which is intentionally conservative: the
 * local quiet boundary never frees capacity before the deployed limiter
 * would. The count is decided at admission because the deployed limiter
 * received the request before completion, so a completion-time reset must
 * never overwrite the consumed count.
 */
export const magicLinkOperationWindowMs =
  betterAuthMagicLinkOptions.rateLimit.window * 1000;
export const magicLinkOperationsPerWindow =
  betterAuthMagicLinkOptions.rateLimit.max - 1;

export type MagicLinkRateBudget = {
  readonly run: <A, E, R>(
    operation: MagicLinkOperation,
    effect: Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E, R>;
};

export type MagicLinkOperation = "send" | "verify";

type MagicLinkRateLimitState = {
  count: number;
  lastRequest: number;
};

/**
 * The count this admission will consume, captured from the stored state at
 * admission time and written only once the operation completes.
 */
type MagicLinkAdmission = {
  readonly nextCount: number;
};

export const makeMagicLinkRateBudget = (
  options: {
    readonly maxPerWindow?: number;
    readonly now?: () => number;
    readonly windowMs?: number;
    readonly retryAfterNotReady?: () => Effect.Effect<void>;
  } = {}
): MagicLinkRateBudget => {
  const maxPerWindow = options.maxPerWindow ?? magicLinkOperationsPerWindow;
  const windowMs = options.windowMs ?? magicLinkOperationWindowMs;
  const now = options.now ?? Date.now;
  const retryAfterNotReady =
    options.retryAfterNotReady ?? (() => Effect.sleep("1 second"));
  const states = new Map<MagicLinkOperation, MagicLinkRateLimitState>();

  const admit = (
    operation: MagicLinkOperation
  ): MagicLinkAdmission | undefined => {
    const current = now();
    const state = states.get(operation);
    if (!state || current - state.lastRequest >= windowMs) {
      return { nextCount: 1 };
    }
    if (state.count < maxPerWindow) {
      return { nextCount: state.count + 1 };
    }
    return undefined;
  };

  const run = <A, E, R>(
    operation: MagicLinkOperation,
    effect: Effect.Effect<A, E, R>
  ): Effect.Effect<A, E, R> =>
    Effect.suspend(() => {
      const admission = admit(operation);
      // Wait before issuing a link, not while its expiry clock is running.
      // The serial lane consumes no verification capacity between send and use.
      if (!admission || (operation === "send" && !admit("verify"))) {
        return Effect.andThen(retryAfterNotReady(), () =>
          run(operation, effect)
        );
      }
      return effect.pipe(
        Effect.onExit(() =>
          Effect.sync(() => {
            states.set(operation, {
              count: admission.nextCount,
              lastRequest: now(),
            });
          })
        )
      );
    });

  return { run };
};
