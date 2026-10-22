import { Context, Effect, Layer, Option, Schema } from "effect";
import { administrationAgentScope } from "@/features/account/agent-scopes";
import type { CustomerAgentConnection } from "@/features/account/customer-agent-connections";
import { customerAgentConsentScopes } from "@/features/account/customer-agent-routes";
import {
  type CustomerAccountAccessError,
  customerAccountUnavailable,
} from "../../customer-account";
import { CustomerAgentClientDirectory } from "./customer-agent-client-directory.service";

/** The consent fields the account page needs. */
const consentRowSchema = Schema.Struct({
  id: Schema.String,
  clientId: Schema.String,
  scopes: Schema.Array(Schema.String),
  createdAt: Schema.Union([Schema.Date, Schema.String]),
});
const decodeConsentRows = Schema.decodeUnknownEffect(
  Schema.Array(consentRowSchema)
);

const connectionsUnavailable = () =>
  customerAccountUnavailable("authentication.agent-connections");

/**
 * The Better Auth read behind the connections, injected so tests run without
 * the singleton.
 */
export interface CustomerAgentConsentAuthority {
  /** The signed-in customer's OAuth consents for the current request. */
  readonly listConsents: () => Promise<unknown>;
}

interface ICustomerAgentConnections {
  /**
   * The AI assistants the current session's customer has connected, oldest
   * first, each named from its client metadata when it can be read.
   */
  readonly list: Effect.Effect<
    readonly CustomerAgentConnection[],
    CustomerAccountAccessError
  >;
}

/**
 * The AI assistants a customer has let use their account. Each connection
 * is one Better Auth OAuth consent; Better Auth types never leave this
 * adapter.
 */
export class CustomerAgentConnections extends Context.Service<
  CustomerAgentConnections,
  ICustomerAgentConnections
>()("@deskohub-workspace/account/CustomerAgentConnections") {
  static fromAuthority = (authority: CustomerAgentConsentAuthority) =>
    Layer.effect(
      this,
      Effect.map(CustomerAgentClientDirectory, (directory) => ({
        list: Effect.tryPromise({
          try: () => authority.listConsents(),
          catch: connectionsUnavailable,
        }).pipe(
          Effect.flatMap((rows) =>
            decodeConsentRows(rows).pipe(
              Effect.mapError(connectionsUnavailable)
            )
          ),
          Effect.flatMap((rows) =>
            Effect.forEach(
              rows,
              (row) =>
                directory.find(row.clientId).pipe(
                  // An unreadable client stays listed, unnamed, so the
                  // customer can still disconnect it.
                  Effect.orElseSucceed(() => Option.none()),
                  Effect.map(
                    (client): CustomerAgentConnection => ({
                      id: row.id,
                      name: Option.getOrUndefined(client)?.name,
                      host: Option.getOrUndefined(client)?.host,
                      scopes: customerAgentConsentScopes.filter((scope) =>
                        row.scopes.includes(scope)
                      ),
                      administration: row.scopes.includes(
                        administrationAgentScope
                      ),
                      connectedAt: new Date(row.createdAt).toISOString(),
                    })
                  )
                ),
              { concurrency: "unbounded" }
            )
          ),
          Effect.map((connections) =>
            connections.toSorted((left, right) =>
              left.connectedAt.localeCompare(right.connectedAt)
            )
          ),
          Effect.withSpan("CustomerAgentConnections.list")
        ),
      }))
    );

  static Default = Layer.unwrap(
    Effect.promise(async () => {
      const [{ auth }, { headers }] = await Promise.all([
        import("@/features/account/server/auth.server"),
        import("next/headers"),
      ]);
      return CustomerAgentConnections.fromAuthority({
        listConsents: async () =>
          auth.api.getOAuthConsents({ headers: await headers() }),
      });
    })
  ).pipe(Layer.provide(CustomerAgentClientDirectory.Default));
}
