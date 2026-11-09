import { CliServiceUnavailable } from "@deskohub/workspace-admin-api";
import { Effect } from "effect";

export const makeServiceUnavailable = () =>
  new CliServiceUnavailable({
    message: "The administration API is temporarily unavailable.",
  });

/**
 * Maps a failure to its public API error. A service-unavailable response
 * carries no cause, so the original failure is logged first; otherwise an
 * operator would see the 503 with no record of what failed.
 */
export const mapAdministrationApiFailure =
  <E, F>(toPublicFailure: (cause: E) => F) =>
  <A, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, F, R> =>
    effect.pipe(
      Effect.catch((cause) => {
        const failure = toPublicFailure(cause);
        return Effect.logError("Administration API request failed", {
          cause,
        }).pipe(
          Effect.when(Effect.succeed(failure instanceof CliServiceUnavailable)),
          Effect.andThen(Effect.fail(failure))
        );
      })
    );

export const mapServiceFailure = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(mapAdministrationApiFailure(makeServiceUnavailable));
