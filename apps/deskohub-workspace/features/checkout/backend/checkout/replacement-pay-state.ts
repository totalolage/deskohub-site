import { Effect, Match } from "effect";
import type { PayStateTokenError, SignedPayState } from "./pay-state";

export const recoverReplacementPayState = <R>(
  lookup: Effect.Effect<SignedPayState, PayStateTokenError, R>
) =>
  lookup.pipe(
    Effect.catch((cause) =>
      Match.value(cause).pipe(
        Match.discriminatorsExhaustive("code")({
          "missing-secret": () =>
            Effect.logWarning(
              "Replacement Pay state configuration unavailable; loading ordinary availability",
              { cause }
            ).pipe(Effect.as(undefined)),
          "invalid-secret": () =>
            Effect.logWarning(
              "Replacement Pay state configuration unavailable; loading ordinary availability",
              { cause }
            ).pipe(Effect.as(undefined)),
          "invalid-token": () => Effect.succeed(undefined),
          "unknown-kid": () => Effect.succeed(undefined),
          expired: () => Effect.succeed(undefined),
        })
      )
    )
  );
