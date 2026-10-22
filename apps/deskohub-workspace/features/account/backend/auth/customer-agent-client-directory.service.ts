import { Context, Data, Effect, Layer, Option, Schema } from "effect";
import {
  CustomerAgentAuthorizationError,
  type CustomerAgentClientId,
  customerAgentClientIdSchema,
  isProviderRejection,
} from "./customer-agent-authorization.service";

/** What the consent page shows about the agent asking for access. */
type CustomerAgentClient = {
  readonly clientId: CustomerAgentClientId;
  /** The name the agent gives itself in its metadata document. */
  readonly name: string;
  /**
   * The host the agent's metadata lives on, so customers can tell a
   * look-alike name from the real one. Absent when the client ID isn't a URL
   * and the agent names no home page.
   */
  readonly host?: string;
};

/** The public client fields the consent page needs. */
const publicClientSchema = Schema.Struct({
  client_id: Schema.String,
  client_name: Schema.optional(Schema.String),
  client_uri: Schema.optional(Schema.String),
});

/** The server doesn't know the client or won't serve it. */
class UnknownCustomerAgentClient extends Data.TaggedError(
  "UnknownCustomerAgentClient"
) {}

const decodePublicClient = Schema.decodeUnknownOption(publicClientSchema);
const decodeClientId = Schema.decodeUnknownOption(customerAgentClientIdSchema);

const hostOf = (value: string | undefined) =>
  value !== undefined && URL.canParse(value) ? new URL(value).host : undefined;

/**
 * The Better Auth read behind the directory, injected so tests run without
 * the singleton.
 */
export interface CustomerAgentClientAuthority {
  /**
   * The client's public metadata, resolving a Client ID Metadata Document on
   * first use. Rejects with an error named `APIError` for a client the
   * server doesn't know or won't serve, or answers null, and rejects with
   * anything else when the read itself fails.
   */
  readonly findPublicClient: (clientId: string) => Promise<unknown>;
}

const toClient = (
  publicClient: typeof publicClientSchema.Type
): Option.Option<CustomerAgentClient> =>
  Option.all({
    clientId: decodeClientId(publicClient.client_id),
    name: Option.fromNullishOr(publicClient.client_name?.trim() || undefined),
  }).pipe(
    Option.map(({ clientId, name }) => {
      const host =
        hostOf(publicClient.client_id) ?? hostOf(publicClient.client_uri);
      return { clientId, name, ...(host && { host }) };
    })
  );

interface ICustomerAgentClientDirectory {
  /**
   * The agent behind `clientId`, or none for a client the server doesn't
   * know or that names nothing to show. Fails `unavailable` when the read
   * fails.
   */
  readonly find: (
    clientId: string
  ) => Effect.Effect<
    Option.Option<CustomerAgentClient>,
    CustomerAgentAuthorizationError
  >;
}

/**
 * The OAuth clients customers connect as AI agents, as the consent page
 * shows them. Better Auth types never leave this adapter.
 */
export class CustomerAgentClientDirectory extends Context.Service<
  CustomerAgentClientDirectory,
  ICustomerAgentClientDirectory
>()("@deskohub-workspace/account/CustomerAgentClientDirectory") {
  static fromAuthority = (authority: CustomerAgentClientAuthority) =>
    Layer.succeed(this, {
      find: Effect.fn("CustomerAgentClientDirectory.find")(function* (
        clientId: string
      ) {
        const found = yield* Effect.tryPromise({
          try: () => authority.findPublicClient(clientId),
          catch: (cause) =>
            isProviderRejection(cause)
              ? new UnknownCustomerAgentClient()
              : new CustomerAgentAuthorizationError({ reason: "unavailable" }),
        }).pipe(
          Effect.map(Option.some),
          Effect.catchTag("UnknownCustomerAgentClient", () =>
            Effect.succeed(Option.none<unknown>())
          )
        );
        return Option.flatMap(found, decodePublicClient).pipe(
          Option.flatMap(toClient)
        );
      }),
    });

  /**
   * Reads clients for the server itself, without a customer session, for
   * requests that carry only an agent's access token.
   */
  static Server = Layer.unwrap(
    Effect.promise(async () => {
      const { auth, customerMcpResource } = await import(
        "@/features/account/server/auth.server"
      );
      return CustomerAgentClientDirectory.fromAuthority({
        findPublicClient: (clientId) =>
          auth.api.findCustomerAgentClient({
            body: { clientId },
            // Direct calls resolve the dynamic base URL from a host; the MCP
            // resource's host is trusted on every deployment.
            headers: new Headers({ host: new URL(customerMcpResource).host }),
          }),
      });
    })
  );

  /** Reads clients for the signed-in customer of the current request. */
  static Default = Layer.unwrap(
    Effect.promise(async () => {
      const [{ auth }, { headers }] = await Promise.all([
        import("@/features/account/server/auth.server"),
        import("next/headers"),
      ]);
      return CustomerAgentClientDirectory.fromAuthority({
        findPublicClient: async (clientId) =>
          auth.api.getOAuthClientPublic({
            query: { client_id: clientId },
            headers: await headers(),
          }),
      });
    })
  );
}
