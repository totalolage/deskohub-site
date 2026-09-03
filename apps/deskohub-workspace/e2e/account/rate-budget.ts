import { Effect } from "effect";

/**
 * The deployed Better Auth magic-link endpoints allow a fixed number of
 * requests per client IP and path per rolling window. All account cases in a
 * run share the runner's egress IP, so the serial account lane reserves a
 * slot here before every send or verification. The budget stays below the
 * deployed ceiling so concurrent browser traffic can never trip the real
 * limiter.
 */
export const magicLinkOperationWindowMs = 600_000;
export const magicLinkOperationsPerWindow = 4;

export type MagicLinkRateBudget = {
  readonly reserve: (operation: MagicLinkOperation) => Effect.Effect<void>;
  readonly tryReserve: (operation: MagicLinkOperation) => boolean;
};

export type MagicLinkOperation = "send" | "verify";

export const makeMagicLinkRateBudget = (
  options: {
    readonly maxPerWindow?: number;
    readonly now?: () => number;
    readonly windowMs?: number;
  } = {}
): MagicLinkRateBudget => {
  const maxPerWindow = options.maxPerWindow ?? magicLinkOperationsPerWindow;
  const windowMs = options.windowMs ?? magicLinkOperationWindowMs;
  const now = options.now ?? Date.now;
  const timestampsByOperation = new Map<MagicLinkOperation, number[]>([
    ["send", []],
    ["verify", []],
  ]);

  const tryReserve = (operation: MagicLinkOperation): boolean => {
    const current = now();
    const timestamps = (timestampsByOperation.get(operation) ?? []).filter(
      (timestamp) => current - timestamp < windowMs
    );
    if (timestamps.length >= maxPerWindow) {
      timestampsByOperation.set(operation, timestamps);
      return false;
    }
    timestamps.push(current);
    timestampsByOperation.set(operation, timestamps);
    return true;
  };

  const reserve = (operation: MagicLinkOperation): Effect.Effect<void> =>
    Effect.suspend(() => {
      if (tryReserve(operation)) return Effect.void;
      return Effect.sleep("1 second").pipe(Effect.andThen(reserve(operation)));
    });

  return { reserve, tryReserve };
};
