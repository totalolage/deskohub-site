import type { User as BetterAuthUser } from "better-auth";
import { Context, Data, Effect, Layer, Option, Schema } from "effect";
import { type AgentScope, isAgentScope } from "../../agent-scopes";
import {
  CustomerAccountAccessError,
  CustomerAccountFailureCause,
  type CustomerAccountId,
  customerAccountIdSchema,
} from "../../customer-account";
import {
  type CustomerAccountSession,
  CustomerAuthentication,
  decodeCustomerAccountSession,
} from "../customer-authentication.service";

export const customerAgentClientIdSchema = Schema.NonEmptyString.pipe(
  Schema.brand("CustomerAgentClientId")
).annotate({
  identifier: "CustomerAgentClientId",
  description:
    "OAuth client ID of a customer's AI agent: its Client ID Metadata Document URL.",
});

export type CustomerAgentClientId = typeof customerAgentClientIdSchema.Type;

/**
 * What a verified agent access token lets the agent do: act for one customer
 * account with the scopes the customer granted to one client.
 */
export type CustomerAgentGrant = {
  readonly accountId: CustomerAccountId;
  readonly clientId: CustomerAgentClientId;
  readonly scopes: ReadonlySet<AgentScope>;
};

/** An agent whose access token a request authorized. */
export interface CustomerAgentCaller {
  readonly grant: CustomerAgentGrant;
  readonly accessToken: string;
}

/**
 * Why a token grants nothing. `invalid-token` covers unknown, expired,
 * revoked, and foreign-audience tokens; `account-unavailable` a deleted,
 * deletion-pending, or unverified account. Both answer the agent with an
 * `invalid_token` challenge. `unavailable` is an infrastructure failure.
 */
export class CustomerAgentAuthorizationError extends Data.TaggedError(
  "CustomerAgentAuthorizationError"
)<{
  readonly reason: "invalid-token" | "account-unavailable" | "unavailable";
}> {}

/** The introspection claims of a validated token that the grant needs. */
const accessTokenClaimsSchema = Schema.Struct({
  active: Schema.Boolean,
  sub: Schema.optional(Schema.String),
  client_id: Schema.optional(Schema.String),
  scope: Schema.optional(Schema.String),
  aud: Schema.optional(
    Schema.Union([Schema.String, Schema.Array(Schema.String)])
  ),
});

/**
 * The Better Auth reads behind agent authorization, injected so tests run
 * without the singleton.
 */
export interface CustomerAgentAuthority {
  /** The canonical URL of this deployment's customer MCP server. */
  readonly resource: string;
  /**
   * The token's introspection claims. Rejects with an error named
   * `APIError` for a token the provider doesn't know, and with anything
   * else when the check itself fails.
   */
  readonly validateAccessToken: (token: string) => Promise<unknown>;
  /** The identity row of an account, or null once it is deleted. */
  readonly findUser: (
    accountId: CustomerAccountId
  ) => Promise<BetterAuthUser | null>;
}

/**
 * Whether Better Auth refused the request itself, such as an unknown token or
 * client. Its own failures, which surface as 5xx API errors, are not refusals.
 */
export const isProviderRejection = (cause: unknown) =>
  cause instanceof Error &&
  cause.name === "APIError" &&
  !(Number((cause as { readonly statusCode?: unknown }).statusCode) >= 500);

const invalidToken = () =>
  new CustomerAgentAuthorizationError({ reason: "invalid-token" });
const accountUnavailable = () =>
  new CustomerAgentAuthorizationError({ reason: "account-unavailable" });
const unavailable = () =>
  new CustomerAgentAuthorizationError({ reason: "unavailable" });

const audienceIncludes = (
  audience: string | ReadonlyArray<string> | undefined,
  resource: string
) => [audience ?? []].flat().includes(resource);

const decodeClaims = Schema.decodeUnknownOption(accessTokenClaimsSchema);
const decodeAccountId = Schema.decodeUnknownOption(customerAccountIdSchema);
const decodeClientId = Schema.decodeUnknownOption(customerAgentClientIdSchema);

const toScopes = (scope: string | undefined): ReadonlySet<AgentScope> =>
  new Set((scope ?? "").split(" ").filter(isAgentScope));

/**
 * Verifies the token and re-reads the account it names, so every check sees
 * the current revocation and deletion state.
 */
const authorizeSession = (authority: CustomerAgentAuthority) =>
  Effect.fn("CustomerAgentAuthorization.authorize")(function* (
    accessToken: string
  ) {
    const claims = yield* Effect.tryPromise({
      try: () => authority.validateAccessToken(accessToken),
      catch: (cause) =>
        isProviderRejection(cause) ? invalidToken() : unavailable(),
    }).pipe(
      Effect.map(decodeClaims),
      Effect.flatMap(Effect.fromOption),
      Effect.mapError((error) =>
        error instanceof CustomerAgentAuthorizationError ? error : unavailable()
      ),
      Effect.filterOrFail(
        (decoded) =>
          decoded.active && audienceIncludes(decoded.aud, authority.resource),
        invalidToken
      )
    );

    const accountId = yield* Effect.fromOption(
      decodeAccountId(claims.sub)
    ).pipe(Effect.mapError(invalidToken));
    const clientId = yield* Effect.fromOption(
      decodeClientId(claims.client_id)
    ).pipe(Effect.mapError(invalidToken));

    const user = yield* Effect.tryPromise({
      try: () => authority.findUser(accountId),
      catch: unavailable,
    });
    const session = yield* decodeCustomerAccountSession(
      user ? { user } : null
    ).pipe(
      Effect.mapError((error) =>
        error.reason === "unavailable" ? unavailable() : accountUnavailable()
      ),
      Effect.flatMap((decoded) =>
        decoded && decoded.accountId === accountId && !decoded.deletionRequested
          ? Effect.succeed(decoded)
          : Effect.fail(accountUnavailable())
      )
    );

    const grant: CustomerAgentGrant = {
      accountId,
      clientId,
      scopes: toScopes(claims.scope),
    };
    return { grant, session };
  });

const toAccessError = (error: CustomerAgentAuthorizationError) =>
  error.reason === "unavailable"
    ? new CustomerAccountAccessError({
        reason: "unavailable",
        cause: new CustomerAccountFailureCause({
          code: "authentication.agent-token",
        }),
      })
    : new CustomerAccountAccessError({ reason: "unauthenticated" });

interface ICustomerAgentAuthorization {
  /** The grant behind a bearer access token. */
  readonly authorize: (
    accessToken: string
  ) => Effect.Effect<CustomerAgentGrant, CustomerAgentAuthorizationError>;
  /**
   * The customer the token acts for, as the browser session would give it.
   * A token that no longer grants anything reads as signed out.
   */
  readonly currentUser: (
    accessToken: string
  ) => Effect.Effect<CustomerAccountSession, CustomerAccountAccessError>;
}

/**
 * The account boundary for customers' AI agents: turns a verified OAuth
 * access token into the customer identity the browser session provides.
 * A deleted, deletion-pending, or unverified account gets no identity.
 * Better Auth types never leave this adapter.
 */
export class CustomerAgentAuthorization extends Context.Service<
  CustomerAgentAuthorization,
  ICustomerAgentAuthorization
>()("@deskohub-workspace/account/CustomerAgentAuthorization") {
  static fromAuthority = (authority: CustomerAgentAuthority) => {
    const authorize = authorizeSession(authority);
    return Layer.succeed(this, {
      authorize: (accessToken) =>
        authorize(accessToken).pipe(Effect.map(({ grant }) => grant)),
      currentUser: (accessToken) =>
        authorize(accessToken).pipe(
          Effect.map(({ session }) => session),
          Effect.mapError(toAccessError)
        ),
    });
  };

  static Default = Layer.unwrap(
    Effect.promise(() => import("@/features/account/server/auth.server")).pipe(
      Effect.map(({ auth, customerMcpResource }) =>
        CustomerAgentAuthorization.fromAuthority({
          resource: customerMcpResource,
          validateAccessToken: (token) =>
            auth.api.verifyCustomerAgentAccessToken({
              body: { token },
              // Direct calls resolve the dynamic base URL from a host; the
              // MCP resource's host is trusted on every deployment and needs
              // no request store.
              headers: new Headers({ host: new URL(customerMcpResource).host }),
            }),
          findUser: async (accountId) =>
            (await auth.$context).internalAdapter.findUserById(accountId),
        })
      )
    )
  );
}

/**
 * The customer authentication of a request an agent makes with this access
 * token. Every read re-verifies the token, so checks under the account lock
 * stay authoritative.
 */
export const customerAuthenticationForAgent = (accessToken: string) =>
  Layer.effect(
    CustomerAuthentication,
    Effect.gen(function* () {
      const authorization = yield* CustomerAgentAuthorization;
      return {
        currentUser: authorization
          .currentUser(accessToken)
          .pipe(
            Effect.map((session): CustomerAccountSession | null => session)
          ),
      };
    })
  );

/** The bearer access token of an agent's request, if it sent one. */
export const readAgentAccessToken = (headers: Headers) =>
  Option.fromNullishOr(headers.get("authorization")).pipe(
    Option.flatMap((value) => {
      const match = /^Bearer ([^\s]+)$/i.exec(value.trim());
      return Option.fromNullishOr(match?.[1]);
    })
  );
