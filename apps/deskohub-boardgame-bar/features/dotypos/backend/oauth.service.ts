import { Context, Data, Effect, Layer } from "effect";
import { env } from "@/env";

const DOTYPOS_AUTH_URL = "https://admin.dotypos.com/client/connect";
const DOTYPOS_TOKEN_URL = "https://api.dotykacka.cz/v2/oauth/token";

class DotyposOAuthConfigError extends Data.TaggedError(
  "DotyposOAuthConfigError"
)<{
  readonly message: string;
}> {}

class DotyposTokenExchangeError extends Data.TaggedError(
  "DotyposTokenExchangeError"
)<{
  readonly details: string;
  readonly status: number;
  readonly statusText: string;
}> {}

class DotyposTokenResponseError extends Data.TaggedError(
  "DotyposTokenResponseError"
)<{
  readonly cause?: unknown;
  readonly message: string;
}> {}

interface DotyposTokenResponse {
  readonly accessToken?: string;
  readonly expiresIn?: number;
  readonly refreshToken?: string;
  readonly tokenType?: string;
}

interface DotyposOAuthServiceShape {
  readonly exchangeCode: (input: {
    readonly code: string;
    readonly redirectUri: string;
  }) => Effect.Effect<
    DotyposTokenResponse,
    | DotyposOAuthConfigError
    | DotyposTokenExchangeError
    | DotyposTokenResponseError
  >;
  readonly getAuthUrl: (input: {
    readonly redirectUri: string;
  }) => Effect.Effect<
    { readonly authUrl: string; readonly state: string },
    DotyposOAuthConfigError
  >;
}

const getCredentials = Effect.sync(() => ({
  clientId: env.DOTYPOS_CLIENT_ID,
  clientSecret: env.DOTYPOS_CLIENT_SECRET,
})).pipe(
  Effect.flatMap(({ clientId, clientSecret }) =>
    clientId && clientSecret
      ? Effect.succeed({ clientId, clientSecret })
      : Effect.fail(
          new DotyposOAuthConfigError({
            message: "Missing Dotypos configuration",
          })
        )
  )
);

function isTokenResponse(data: unknown): data is {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
} {
  return data !== null && typeof data === "object";
}

export class DotyposOAuthService extends Context.Service<
  DotyposOAuthService,
  DotyposOAuthServiceShape
>()("DotyposOAuthService") {
  static Live = Layer.succeed(this, {
    getAuthUrl: ({ redirectUri }) =>
      Effect.gen(function* () {
        const { clientId, clientSecret } = yield* getCredentials;
        const state = Math.random().toString(36).slice(2);
        const authUrl = new URL(DOTYPOS_AUTH_URL);
        authUrl.searchParams.append("client_id", clientId);
        authUrl.searchParams.append("client_secret", clientSecret);
        authUrl.searchParams.append("scope", "*");
        authUrl.searchParams.append("redirect_uri", redirectUri);
        authUrl.searchParams.append("state", state);

        return { authUrl: authUrl.toString(), state };
      }),
    exchangeCode: ({ code, redirectUri }) =>
      Effect.gen(function* () {
        const { clientId, clientSecret } = yield* getCredentials;
        const tokenParams = new URLSearchParams({
          grant_type: "authorization_code",
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
        });

        yield* Effect.logInfo("Dotypos token exchange request started");
        const tokenResponse = yield* Effect.tryPromise({
          try: () =>
            fetch(DOTYPOS_TOKEN_URL, {
              method: "POST",
              headers: {
                "Content-Type": "application/x-www-form-urlencoded",
              },
              body: tokenParams,
            }),
          catch: (cause) =>
            new DotyposTokenResponseError({
              message: "Token exchange request failed",
              cause,
            }),
        });

        if (!tokenResponse.ok) {
          const details = yield* Effect.tryPromise({
            try: () => tokenResponse.text(),
            catch: (cause) =>
              new DotyposTokenResponseError({
                message: "Token exchange error body failed",
                cause,
              }),
          });

          return yield* Effect.fail(
            new DotyposTokenExchangeError({
              details,
              status: tokenResponse.status,
              statusText: tokenResponse.statusText,
            })
          );
        }

        const tokenData: unknown = yield* Effect.tryPromise({
          try: () => tokenResponse.json() as Promise<unknown>,
          catch: (cause) =>
            new DotyposTokenResponseError({
              message: "Token response parse failed",
              cause,
            }),
        });

        if (!isTokenResponse(tokenData)) {
          return yield* Effect.fail(
            new DotyposTokenResponseError({
              message: "Invalid token response format",
            })
          );
        }

        return {
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token,
          expiresIn: tokenData.expires_in,
          tokenType: tokenData.token_type,
        };
      }),
  });
}
