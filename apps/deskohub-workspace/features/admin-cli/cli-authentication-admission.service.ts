import { checkRateLimit } from "@vercel/firewall";
import { Context, Data, Effect, Layer } from "effect";
import { HttpServerRequest } from "effect/unstable/http";

export const cliAuthenticationStartRateLimitId = "cli-authentication-start";

interface ICliAuthenticationAdmission {
  readonly isStartAllowed: Effect.Effect<
    boolean,
    CliAuthenticationAdmissionError,
    HttpServerRequest.HttpServerRequest
  >;
}

export class CliAuthenticationAdmission extends Context.Service<
  CliAuthenticationAdmission,
  ICliAuthenticationAdmission
>()("@deskohub-workspace/admin-cli/CliAuthenticationAdmission") {
  static Default = Layer.succeed(this, {
    isStartAllowed: HttpServerRequest.HttpServerRequest.pipe(
      Effect.flatMap((request) =>
        Effect.tryPromise({
          try: () =>
            checkRateLimit(cliAuthenticationStartRateLimitId, {
              headers: request.headers,
            }),
          catch: () => new CliAuthenticationAdmissionError(),
        })
      ),
      Effect.flatMap(({ error, rateLimited }) =>
        error === "not-found"
          ? Effect.fail(new CliAuthenticationAdmissionError())
          : Effect.succeed(!rateLimited)
      )
    ),
  });
}

export class CliAuthenticationAdmissionError extends Data.TaggedError(
  "CliAuthenticationAdmissionError"
) {}
