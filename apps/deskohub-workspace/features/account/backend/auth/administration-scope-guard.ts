import { APIError } from "better-auth";
import { type createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Effect, Match, Option, Schema } from "effect";
import type { SqlError } from "effect/unstable/sql";
import { administrationAgentScope } from "../../agent-scopes";
import {
  type CustomerAccountId,
  customerAccountIdSchema,
} from "../../customer-account";

type AuthRequest = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

/** Whether an account holds the administrator grant right now. */
export type AdministratorGrantCheck = (
  accountId: CustomerAccountId
) => Effect.Effect<boolean, EffectDrizzleQueryError>;

/**
 * Deletes the account's tokens for one agent that carry the administration
 * scope although its consent no longer names it.
 */
export type AdministrationTokenRevocation = (input: {
  readonly accountId: CustomerAccountId;
  readonly clientId: string;
}) => Effect.Effect<unknown, EffectDrizzleQueryError | SqlError.SqlError>;

/** The consent answer fields the guards read from the request body. */
const consentAnswerSchema = Schema.Struct({
  accept: Schema.optional(Schema.Boolean),
  scope: Schema.optional(Schema.String),
  oauth_query: Schema.optional(Schema.String),
});

/**
 * Authorization parameters from a query or a form body. A repeated `scope`
 * arrives as an array; every value counts.
 */
const authorizationParametersSchema = Schema.Struct({
  client_id: Schema.String,
  scope: Schema.optional(
    Schema.Union([Schema.String, Schema.Array(Schema.String)])
  ),
});

/** The OAuth client fields the guard reads. */
const storedOAuthClientSchema = Schema.Struct({
  skipConsent: Schema.optional(Schema.NullOr(Schema.Boolean)),
  scopes: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
});

const decodeConsentAnswer = Schema.decodeUnknownOption(consentAnswerSchema);
const decodeAuthorizationParameters = Schema.decodeUnknownOption(
  authorizationParametersSchema
);
const decodeStoredOAuthClient = Schema.decodeUnknownOption(
  storedOAuthClientSchema
);

const splitScopes = (scope: string | ReadonlyArray<string>) =>
  [scope].flat().flatMap((value) => value.split(" ").filter(Boolean));

/** An accepted consent answer, if the request carries one. */
const acceptedConsent = (request: AuthRequest) =>
  decodeConsentAnswer(request.body).pipe(
    Option.filter(({ accept }) => accept === true)
  );

const includesAdministration = (scopes: ReadonlyArray<string>) =>
  scopes.includes(administrationAgentScope);

const missingConsentScope = () =>
  new APIError("BAD_REQUEST", {
    error: "invalid_request",
    error_description: "An accepted consent must name its scopes.",
  });

const administrationRefused = () =>
  new APIError("FORBIDDEN", {
    error: "access_denied",
    error_description: "Only an administrator can grant this scope.",
  });

const skipConsentAdministrationRefused = () =>
  new APIError("BAD_REQUEST", {
    error: "invalid_scope",
    error_description:
      "A client that skips consent can't ask for the administration scope.",
  });

/** The account of the request's session, if it has one. */
const sessionAccount = (request: AuthRequest) =>
  Effect.promise(() => getSessionFromCtx(request)).pipe(
    Effect.map((session) =>
      Option.map(Option.fromNullishOr(session), ({ user }) =>
        customerAccountIdSchema.make(user.id)
      )
    )
  );

/** Whether the session's account holds the administrator grant now. */
const sessionHoldsAdministratorGrant = (
  request: AuthRequest,
  hasAdministratorGrant: AdministratorGrantCheck
) =>
  sessionAccount(request).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.succeed(false),
        onSome: hasAdministratorGrant,
      })
    )
  );

/**
 * An accepted consent names the scopes it grants, so the provider never
 * falls back to everything the agent asked for. The administration scope
 * needs a signed-in account that holds the administrator grant now.
 */
const guardConsent = Effect.fn("WorkspaceAuth.guardAgentConsent")(function* (
  request: AuthRequest,
  hasAdministratorGrant: AdministratorGrantCheck
) {
  const answer = acceptedConsent(request);
  if (Option.isNone(answer)) {
    return;
  }
  const scopes = yield* Effect.fromNullishOr(answer.value.scope).pipe(
    Effect.map(splitScopes),
    Effect.mapError(missingConsentScope)
  );
  yield* sessionHoldsAdministratorGrant(request, hasAdministratorGrant).pipe(
    Effect.filterOrFail(Boolean, administrationRefused),
    Effect.when(Effect.succeed(includesAdministration(scopes)))
  );
});

/**
 * Whether the client named by one source of authorization parameters skips
 * consent and asks for administration, by name or through an omitted scope
 * that defaults to its own or the server's list.
 */
const asksForAdministrationWithoutConsent = (
  request: AuthRequest,
  parameters: typeof authorizationParametersSchema.Type
) =>
  Effect.promise(() =>
    request.context.adapter.findOne({
      model: "oauthClient",
      where: [{ field: "clientId", value: parameters.client_id }],
    })
  ).pipe(
    Effect.map((row) =>
      decodeStoredOAuthClient(row).pipe(
        Option.exists(
          (client) =>
            client.skipConsent === true &&
            includesAdministration(
              parameters.scope === undefined
                ? (client.scopes ?? [administrationAgentScope])
                : splitScopes(parameters.scope)
            )
        )
      )
    )
  );

/**
 * A client that skips consent never reaches the consent check, so it can't
 * ask for the administration scope. Better Auth dispatches its own resumed
 * authorizations through this hook too. Both the query and the body are
 * checked, though the provider reads only one of them: a conflicting
 * request is refused rather than resolved.
 */
const guardSkipConsentAuthorization = (request: AuthRequest) =>
  Effect.forEach(
    [request.query, request.body].flatMap((source) =>
      Option.toArray(decodeAuthorizationParameters(source))
    ),
    (parameters) =>
      asksForAdministrationWithoutConsent(request, parameters).pipe(
        Effect.filterOrFail((asks) => !asks, skipConsentAdministrationRefused)
      ),
    { discard: true }
  );

/**
 * Keeps the administration scope off every grant an administrator didn't
 * consent to. This is issuance policy: administration calls re-check the
 * live grant themselves.
 */
export const guardAdministrationScope = (
  request: AuthRequest,
  hasAdministratorGrant: AdministratorGrantCheck
) =>
  Match.value(request.path).pipe(
    Match.when("/oauth2/consent", () =>
      guardConsent(request, hasAdministratorGrant)
    ),
    Match.when("/oauth2/authorize", () =>
      guardSkipConsentAuthorization(request)
    ),
    Match.orElse(() => Effect.void),
    Effect.withSpan("WorkspaceAuth.guardAdministrationScope")
  );

/**
 * After an accepted consent, the agent's tokens that carry the
 * administration scope although its consent no longer names it go: Better
 * Auth rewrites the consent's scopes when the account consents again for
 * fewer, but tokens keep the scopes they were issued with. The stored
 * consent decides, since the step can end before it records the consent or
 * fail after. The provider verified the signed request before the step ran,
 * so its client is the one the consent names, and only the session
 * account's tokens go.
 */
export const narrowAdministrationOnConsent = (
  request: AuthRequest,
  revokeUnconsentedAdministrationTokens: AdministrationTokenRevocation
) =>
  acceptedConsent(request).pipe(
    Option.filter(() => request.path === "/oauth2/consent"),
    Option.match({
      onNone: () => Effect.void,
      onSome: (answer) =>
        Effect.all({
          accountId: sessionAccount(request).pipe(
            Effect.flatMap(Effect.fromOption)
          ),
          clientId: Effect.fromNullishOr(
            new URLSearchParams(answer.oauth_query).get("client_id")
          ),
        }).pipe(
          Effect.flatMap(revokeUnconsentedAdministrationTokens),
          Effect.catchNoSuchElement,
          Effect.asVoid
        ),
    }),
    Effect.withSpan("WorkspaceAuth.narrowAdministrationOnConsent")
  );
