import { DateTime, Effect, Layer } from "effect";
import {
  RequestBudget,
  type RequestBudgetPolicy,
  RequestBudgetSpend,
  RequestBudgetUnavailable,
} from "./request-budget.service";

/**
 * An in-process `RequestBudget`. It records every spend in order and grants
 * a key until it has spent `limit` times, without a rolling window: a spent
 * budget stays exhausted until `reset`. `exhaust` refuses matching keys on
 * top of that.
 */
export const makeMemoryRequestBudget = () => {
  const spends: Array<RequestBudgetPolicy> = [];
  const spentByKey = new Map<string, number>();
  let exhausted: (key: string) => boolean = () => false;

  const spend = (policy: RequestBudgetPolicy): RequestBudgetSpend => {
    spends.push(policy);
    const spent = spentByKey.get(policy.key) ?? 0;
    if (exhausted(policy.key) || spent >= policy.limit) {
      return RequestBudgetSpend.Exhausted({ retryAt: DateTime.nowUnsafe() });
    }
    spentByKey.set(policy.key, spent + 1);
    return RequestBudgetSpend.Granted();
  };

  return {
    layer: Layer.succeed(RequestBudget, {
      spend: (policy) => Effect.sync(() => spend(policy)),
    }),
    /** Every spend asked for, granted or not, in order. */
    spends: (): ReadonlyArray<RequestBudgetPolicy> => [...spends],
    /** Refuses every later spend under a key `when` matches. */
    exhaust: (when: (key: string) => boolean) => {
      exhausted = when;
    },
    /** Forgets every spend and `exhaust`, as a fresh budget. */
    reset: () => {
      spends.length = 0;
      spentByKey.clear();
      exhausted = () => false;
    },
  };
};

/** A budget that can't be checked, as when its store is down. */
export const unavailableRequestBudget = (cause?: unknown) =>
  Layer.succeed(RequestBudget, {
    spend: ({ key }) =>
      Effect.fail(
        new RequestBudgetUnavailable({
          key,
          cause: cause ?? new Error("budget store down"),
        })
      ),
  });
