import { Effect } from "effect";
import type { PayStateTokenError, SignedPayState } from "./pay-state";

export const recoverReplacementPayState = <R>(
  lookup: Effect.Effect<SignedPayState, PayStateTokenError, R>
) =>
  lookup.pipe(
    Effect.catch((cause) => {
      if (cause.code !== "missing-secret" && cause.code !== "invalid-secret") {
        return Effect.succeed(undefined);
      }

      return Effect.logWarning(
        "Replacement Pay state configuration unavailable; loading ordinary availability",
        { cause }
      ).pipe(Effect.as(undefined));
    })
  );
