import {
  AdministrationAuthentication,
  CliBearerAuthentication,
  CliClientCompatibility,
  CliSessionUnauthorized,
  CurrentAdministrationCaller,
} from "@deskohub/workspace-admin-api";
import { NodeHttpServer } from "@effect/platform-node";
import { Data, Effect, Layer, Match, Option, Redacted } from "effect";
import { HttpRouter } from "effect/unstable/http";
import {
  CustomerAgentAuthorization,
  type CustomerAgentAuthorizationError,
} from "@/features/account/backend/auth/customer-agent-authorization.service";
import { CustomerAgentClientDirectory } from "@/features/account/backend/auth/customer-agent-client-directory.service";
import {
  makeServiceUnavailable,
  mapAdministrationApiFailure,
} from "@/features/admin-cli/administration-api-failure";
import {
  makeWorkspaceAdminApiLayer,
  provideWorkspaceAdminApiServices,
} from "@/features/admin-cli/workspace-admin-api.server";
import { AdministratorAgentAuthorization } from "@/features/administrators/backend/administrator-agent-authorization.service";
import { AdministratorAssistantConnections } from "@/features/administrators/backend/administrator-assistant-connections.service";
import {
  WorkspaceObservabilityLive,
  workspaceMemoMap,
} from "@/shared/backend/workspace-effect";
import { assistantAccessEnded } from "./administration-assistant-refusal";

/** The token's client isn't known, or names nothing to record. */
class UnknownAssistantClient extends Data.TaggedError(
  "UnknownAssistantClient"
) {}

/** Authenticating died, as when a connection disappears while it's read. */
class AssistantAuthenticationDefect extends Data.TaggedError(
  "AssistantAuthenticationDefect"
)<{ readonly defect: unknown }> {}

type AgentAuthorizationReason =
  | CustomerAgentAuthorizationError["reason"]
  | Effect.Error<
      ReturnType<AdministratorAgentAuthorization["Service"]["authorize"]>
    >["reason"];

/** The refusal an authorization reason stands for; none for an outage. */
const refusalOfReason = (reason: AgentAuthorizationReason) =>
  Match.value(reason).pipe(
    Match.when("unavailable", () => Option.none<string>()),
    Match.whenOr(
      "invalid-token",
      "account-unavailable",
      "missing-scope",
      "not-administrator",
      (refusal): Option.Option<string> => Option.some(refusal)
    ),
    Match.exhaustive
  );

/**
 * Authenticates an AI assistant's OAuth access token for an administration
 * operation and provides its caller: the administrator the token acts for,
 * on the assistant's connection. The token, the administration scope and
 * the administrator grant are checked on every request, and the caller
 * comes only from them, never from request input.
 */
const AdministratorAssistantAuthenticationLive = Layer.effect(
  AdministrationAuthentication,
  Effect.gen(function* () {
    const agents = yield* CustomerAgentAuthorization;
    const administrators = yield* AdministratorAgentAuthorization;
    const clients = yield* CustomerAgentClientDirectory;
    const connections = yield* AdministratorAssistantConnections;

    const authenticate = Effect.fn(
      "AdministratorAssistantAuthentication.authenticate"
    )(function* (accessToken: string) {
      const grant = yield* agents.authorize(accessToken);
      const actor = yield* administrators.authorize({ grant, accessToken });
      const client = yield* clients.find(grant.clientId).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.fail(new UnknownAssistantClient()),
            onSome: Effect.succeed,
          })
        )
      );
      const channel = yield* connections.connect({
        actor,
        oauthClientId: grant.clientId,
        clientName: client.name,
      });
      return { actor, channel };
    });

    /** Why the token may not act in the administration, if it was refused. */
    const refusalOf = (
      cause:
        | Effect.Error<ReturnType<typeof authenticate>>
        | AssistantAuthenticationDefect
    ): Option.Option<string> =>
      Match.value(cause).pipe(
        Match.tagsExhaustive({
          CustomerAgentAuthorizationError: ({ reason }) =>
            refusalOfReason(reason),
          AdministratorAgentAuthorizationError: ({ reason }) =>
            refusalOfReason(reason),
          UnknownAssistantClient: () => Option.some("unknown-client"),
          EffectDrizzleQueryError: () => Option.none(),
          AssistantAuthenticationDefect: () => Option.none(),
        })
      );

    return {
      bearer: (httpEffect, { credential }) =>
        authenticate(Redacted.value(credential)).pipe(
          Effect.catchDefect((defect) =>
            Effect.fail(new AssistantAuthenticationDefect({ defect }))
          ),
          Effect.tapError((cause) =>
            Option.match(refusalOf(cause), {
              onNone: () => Effect.void,
              onSome: (reason) =>
                Effect.logInfo("Assistant administration access was refused", {
                  reason,
                }),
            })
          ),
          mapAdministrationApiFailure((cause) =>
            Option.isSome(refusalOf(cause))
              ? assistantAccessEnded()
              : makeServiceUnavailable()
          ),
          Effect.flatMap((caller) =>
            Effect.provideService(
              httpEffect,
              CurrentAdministrationCaller,
              caller
            )
          )
        ),
    } satisfies AdministrationAuthentication["Service"];
  })
);

/**
 * `cli.getCurrentSession` reports the calling CLI session; an assistant has
 * none, so this instance refuses every CLI bearer.
 */
const RefusedCliSessionAuthentication = Layer.succeed(CliBearerAuthentication, {
  bearer: () =>
    Effect.fail(
      new CliSessionUnauthorized({
        message: "CLI sessions can't be used through an AI assistant.",
      })
    ),
});

/**
 * Admits every request: the assistant's tools are derived from the current
 * contract, so no released `dhw` decodes these responses.
 */
const AssistantClientCompatibilityLive = Layer.succeed(
  CliClientCompatibility,
  (httpEffect) => httpEffect
);

/**
 * The administration API's HTTP app for AI assistants. Its operations
 * authenticate OAuth access tokens and never CLI bearers.
 */
export const makeAdministrationAssistantApiLayer = () =>
  makeWorkspaceAdminApiLayer({
    authentication: AdministratorAssistantAuthenticationLive,
    sessionAuthentication: RefusedCliSessionAuthentication,
    clientCompatibility: AssistantClientCompatibilityLive,
  });

/**
 * Answers an administration API request an administrator's AI assistant
 * makes through its tools, in process. No route serves it.
 */
export const handleAssistantAdministrationRequest: (
  request: Request
) => Promise<Response> = HttpRouter.toWebHandler(
  Layer.mergeAll(
    provideWorkspaceAdminApiServices(
      makeAdministrationAssistantApiLayer()
    ).pipe(
      Layer.provide(
        Layer.mergeAll(
          CustomerAgentAuthorization.Default,
          AdministratorAgentAuthorization.Live,
          CustomerAgentClientDirectory.Server,
          AdministratorAssistantConnections.Live
        )
      )
    ),
    // As for the CLI's handler: this runs outside the route's Effect runtime,
    // and the Workspace memo map reuses the route runtime's instances.
    WorkspaceObservabilityLive
  ).pipe(Layer.provide(NodeHttpServer.layerHttpServices)),
  { disableLogger: true, memoMap: workspaceMemoMap }
).handler;
