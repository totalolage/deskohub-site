import { Context, Data, Effect, Layer, Option } from "effect";
import { administrationAgentScope } from "@/features/account/agent-scopes";
import { AdministratorAgentAuthorization } from "@/features/administrators/backend/administrator-agent-authorization.service";
import type { AgentTool } from "@/features/agent-tools/agent-tool";
import type { CustomerAgentCaller } from "@/features/agent-tools/customer-agent-caller";
import {
  administrationOperationTools,
  makeAdministrationAgentTools,
} from "./administration-agent-tools";
import type { AdministrationApiClient } from "./administration-api-client";

/**
 * The administrator grant couldn't be checked, so whether the caller may
 * see the administration tools is unknown.
 */
class AdministrationAgentAccessUnavailable extends Data.TaggedError(
  "AdministrationAgentAccessUnavailable"
) {}

type AdministrationAgentTools = ReadonlyArray<
  AgentTool<AdministrationApiClient | AdministratorAgentAuthorization>
>;

interface IAdministrationAgentAccess {
  /**
   * The administration tools the caller may see: every one when its token
   * carries the administration scope and its account holds the
   * administrator grant right now, otherwise none. Fails when the grant
   * can't be checked, so a caller is never shown tools it may not have.
   */
  readonly forCaller: (
    caller: Option.Option<CustomerAgentCaller>
  ) => Effect.Effect<
    AdministrationAgentTools,
    AdministrationAgentAccessUnavailable
  >;
}

/**
 * Decides, per request, whether the MCP route lists the administration
 * tools. Each tool call checks the token and the grant again.
 */
export class AdministrationAgentAccess extends Context.Service<
  AdministrationAgentAccess,
  IAdministrationAgentAccess
>()(
  "@deskohub-workspace/administration-agent-tools/AdministrationAgentAccess"
) {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const authorization = yield* AdministratorAgentAuthorization;
      const tools = makeAdministrationAgentTools(administrationOperationTools);
      const none: AdministrationAgentTools = [];

      return {
        forCaller: (caller) =>
          Option.match(
            Option.filter(caller, ({ grant }) =>
              grant.scopes.has(administrationAgentScope)
            ),
            {
              onNone: () => Effect.succeed(none),
              onSome: (administrationCaller) =>
                authorization.authorize(administrationCaller).pipe(
                  Effect.as(tools),
                  Effect.catchTag(
                    "AdministratorAgentAuthorizationError",
                    ({ reason }) =>
                      reason === "unavailable"
                        ? Effect.fail(
                            new AdministrationAgentAccessUnavailable()
                          )
                        : Effect.logInfo(
                            "Administration tools withheld from an agent",
                            { reason }
                          ).pipe(Effect.as(none))
                  )
                ),
            }
          ),
      } satisfies IAdministrationAgentAccess;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(AdministratorAgentAuthorization.Live)
  );

  /** The administration tools the request's caller may see. */
  static forCaller = (caller: Option.Option<CustomerAgentCaller>) =>
    Effect.flatMap(AdministrationAgentAccess, (access) =>
      access.forCaller(caller)
    );
}
