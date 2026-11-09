import { createResourceServerChallenge } from "@better-auth/oauth-provider";
import { APIError } from "better-auth/api";
import { createInsufficientScopeError } from "better-auth/oauth2";
import { Effect, Match } from "effect";
import type { CustomerAgentScope } from "../../agent-scopes";

/**
 * Why the customer MCP server refuses an agent's request: no access token
 * for a signed-in tool, a token that grants nothing, or a token without a
 * scope the call needs.
 */
export type CustomerAgentChallengeReason =
  | {
      readonly kind: "missing-token";
      /** The scopes to ask the customer for. */
      readonly scopes: ReadonlyArray<CustomerAgentScope>;
    }
  | { readonly kind: "invalid-token" }
  | {
      readonly kind: "insufficient-scope";
      /** The scopes the call needs and the token lacks. */
      readonly scopes: ReadonlyArray<CustomerAgentScope>;
    };

/** The HTTP status and `WWW-Authenticate` header of an OAuth challenge. */
export interface CustomerAgentChallenge {
  readonly status: 401 | 403;
  readonly headers: Readonly<Record<"WWW-Authenticate", string>>;
}

/**
 * The OAuth resource-server challenge for a refused agent request. It points
 * the agent at the protected-resource metadata of the customer MCP server, so
 * a client without a usable token can discover the authorization server.
 */
export const customerAgentChallenge = (reason: CustomerAgentChallengeReason) =>
  Effect.promise(() => import("@/features/account/server/auth.server")).pipe(
    Effect.flatMap(({ customerMcpResource }) =>
      buildCustomerAgentChallenge(reason, customerMcpResource)
    ),
    Effect.withSpan("customerAgentChallenge")
  );

export const buildCustomerAgentChallenge = (
  reason: CustomerAgentChallengeReason,
  resource: string
): Effect.Effect<CustomerAgentChallenge> =>
  Match.value(reason).pipe(
    Match.discriminatorsExhaustive("kind")({
      "missing-token": ({ scopes }) =>
        challenge(
          () =>
            createResourceServerChallenge(
              new APIError("UNAUTHORIZED", { message: "Sign-in required" }),
              resource,
              { challengeScopes: scopes }
            ),
          401
        ),
      "invalid-token": () =>
        challenge(
          () =>
            createResourceServerChallenge(
              new APIError("UNAUTHORIZED", {
                message: "Invalid access token",
              }),
              resource
            ),
          401
        ).pipe(Effect.map(appendInvalidTokenError)),
      "insufficient-scope": ({ scopes }) =>
        challenge(
          () =>
            createResourceServerChallenge(
              createInsufficientScopeError(
                scopes,
                "The access token lacks a scope this tool needs"
              ),
              resource
            ),
          403
        ),
    })
  );

/**
 * Better Auth answers every UNAUTHORIZED and insufficient-scope error with a
 * challenge and throws only on malformed scopes or resources, which are
 * constants here; either failure means its contract changed, so it's a
 * defect.
 */
const challenge = (
  build: () => ReturnType<typeof createResourceServerChallenge>,
  status: CustomerAgentChallenge["status"]
) =>
  Effect.try(build).pipe(
    Effect.map((error) =>
      error ? new Headers(error.headers).get("WWW-Authenticate") : null
    ),
    Effect.flatMap(Effect.fromNullishOr),
    Effect.map(
      (header): CustomerAgentChallenge => ({
        status,
        headers: { "WWW-Authenticate": header },
      })
    ),
    Effect.orDie
  );

/**
 * Better Auth's challenge carries only `resource_metadata` for every 401.
 * RFC 6750 §3.1 asks a resource server to name `invalid_token` when the
 * request had a token that is expired, revoked, or otherwise invalid, so
 * clients refresh or re-authorize instead of retrying it.
 */
const appendInvalidTokenError = (
  challenge: CustomerAgentChallenge
): CustomerAgentChallenge => ({
  ...challenge,
  headers: {
    "WWW-Authenticate": `${challenge.headers["WWW-Authenticate"]}, error="invalid_token"`,
  },
});
