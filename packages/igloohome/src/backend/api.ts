import { Context, Effect, Layer, Predicate, Ref, Schema, Stream } from "effect";
import {
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  type HttpClientResponse,
} from "effect/unstable/http";
import {
  IgloohomeRuntimeConfig,
  type IgloohomeRuntimeConfigObj,
} from "../config";
import { IgloohomeRequestError } from "../errors";
import { type IgloohomeClient, make } from "../generated/effect.gen";

const hourlyAlgoPinScope = "igloohomeapi/algopin-hourly";
const tokenExpirySafetyMarginMs = 60_000;

const accessTokenResponseSchema = Schema.Struct({
  access_token: Schema.NonEmptyString,
  expires_in: Schema.optional(
    Schema.Finite.check(Schema.isInt()).check(Schema.isGreaterThan(0))
  ),
});

const rejectFailedAuthentication = (
  response: HttpClientResponse.HttpClientResponse
) =>
  response.status < 200 || response.status >= 300
    ? Effect.fail(
        new IgloohomeRequestError({
          operation: "authenticate",
          outcome: "rejected",
          statusCode: response.status,
          message: "Igloohome rejected authentication.",
        })
      )
    : Effect.succeed(response);

const decodeAccessTokenResponse = (
  response: HttpClientResponse.HttpClientResponse
) =>
  response.stream.pipe(
    Stream.decodeText(),
    Stream.mkString,
    Effect.flatMap((body) =>
      Schema.decodeUnknownEffect(
        Schema.fromJsonString(accessTokenResponseSchema)
      )(body)
    ),
    Effect.mapError(
      () =>
        new IgloohomeRequestError({
          operation: "authenticate",
          outcome: "rejected",
          statusCode: response.status,
          message: "Igloohome returned an invalid access token.",
        })
    )
  );

type AccessTokenCache = {
  readonly token: string;
  readonly expiresAt: number;
};

interface IIgloohomeAccessToken {
  readonly get: Effect.Effect<string, IgloohomeRequestError>;
}

export class IgloohomeAccessToken extends Context.Service<
  IgloohomeAccessToken,
  IIgloohomeAccessToken
>()("@deskohub/igloohome/IgloohomeAccessToken") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const config = yield* IgloohomeRuntimeConfig;
      const httpClient = yield* HttpClient.HttpClient;
      const tokenCache = yield* Ref.make<AccessTokenCache | null>(null);

      const requestAccessToken = Effect.fn(
        "IgloohomeAccessToken.requestAccessToken"
      )(function* () {
        const authorization = Buffer.from(
          `${config.clientId}:${config.clientSecret}`
        ).toString("base64");
        const request = HttpClientRequest.post(
          new URL("/oauth2/token", config.authUrl).toString()
        ).pipe(
          HttpClientRequest.setHeaders({
            Accept: "application/json",
            Authorization: `Basic ${authorization}`,
          }),
          HttpClientRequest.bodyUrlParams({
            grant_type: "client_credentials",
            scope: hourlyAlgoPinScope,
          })
        );

        const decoded = yield* httpClient.execute(request).pipe(
          Effect.flatMap(rejectFailedAuthentication),
          Effect.flatMap(decodeAccessTokenResponse),
          Effect.timeoutOrElse({
            duration: config.apiTimeout,
            orElse: () =>
              Effect.fail(
                new IgloohomeRequestError({
                  operation: "authenticate",
                  outcome: "rejected",
                  message: "Igloohome authentication timed out.",
                })
              ),
          }),
          Effect.mapError((cause) =>
            Predicate.isTagged(cause, "IgloohomeRequestError")
              ? cause
              : new IgloohomeRequestError({
                  operation: "authenticate",
                  outcome: "rejected",
                  message: "Igloohome authentication failed.",
                })
          )
        );

        const now = Date.now();
        if (decoded.expires_in !== undefined) {
          const expiresInMs = decoded.expires_in * 1000;
          yield* Ref.set(tokenCache, {
            token: decoded.access_token,
            expiresAt:
              now + Math.max(0, expiresInMs - tokenExpirySafetyMarginMs),
          });
        }

        return decoded.access_token;
      });

      const get = Effect.gen(function* () {
        const cached = yield* Ref.get(tokenCache);
        if (cached && Date.now() < cached.expiresAt) return cached.token;
        return yield* requestAccessToken();
      });

      return { get };
    })
  );
}

export const makeIgloohomeClient = ({
  accessToken,
  config,
  httpClient,
}: {
  accessToken: string;
  config: IgloohomeRuntimeConfigObj;
  httpClient: HttpClient.HttpClient;
}): IgloohomeClient =>
  make(
    httpClient.pipe(
      HttpClient.mapRequestInput((request) =>
        request.pipe(
          HttpClientRequest.setHeaders({
            Accept: "application/json",
            Authorization: `Bearer ${accessToken}`,
          })
        )
      )
    ),
    {
      transformClient: (client) =>
        Effect.succeed(
          client.pipe(
            HttpClient.mapRequestInput((request) =>
              request.pipe(HttpClientRequest.prependUrl(config.apiUrl))
            )
          )
        ),
    }
  );

export const mapAlgoPinRequestError = (
  error: unknown
): IgloohomeRequestError => {
  if (error instanceof IgloohomeRequestError) return error;

  const statusCode = getResponseStatus(error);
  const outcome =
    statusCode !== undefined && [400, 401, 403, 404, 415].includes(statusCode)
      ? "rejected"
      : "ambiguous";

  return new IgloohomeRequestError({
    operation: "issue_hourly_algopin",
    outcome,
    ...(statusCode !== undefined && { statusCode }),
    message:
      outcome === "rejected"
        ? "Igloohome rejected the AlgoPIN request."
        : "The outcome of the Igloohome AlgoPIN request is uncertain.",
  });
};

const getResponseStatus = (error: unknown): number | undefined => {
  if (HttpClientError.isHttpClientError(error)) return error.response?.status;
  if (
    Predicate.hasProperty(error, "response") &&
    Predicate.isObject(error.response) &&
    Predicate.hasProperty(error.response, "status") &&
    Predicate.isNumber(error.response.status)
  ) {
    return error.response.status;
  }
  return undefined;
};
