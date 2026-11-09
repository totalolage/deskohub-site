import {
  makeCustomerAuthApiClient,
  makeWorkspaceCustomerApiClient,
} from "@deskohub/workspace-customer-api/client";
import { Context, Effect, Layer } from "effect";
import type { HttpClient } from "effect/unstable/http";

interface ICustomerApiTransport {
  /** The Workspace origin every customer request goes to. */
  readonly apiOrigin: string;
  /** Adapts the HTTP client for customer API requests. */
  readonly customerApi: (
    client: HttpClient.HttpClient
  ) => HttpClient.HttpClient;
  /** Adapts the HTTP client for the Better Auth requests the app makes. */
  readonly customerAuthApi: (
    client: HttpClient.HttpClient
  ) => HttpClient.HttpClient;
}

/**
 * How this platform sends customer requests: native attaches the stored
 * session cookie (and the trusted app origin on Better Auth mutations), web
 * relies on the site's own cookie. Both retry transient read failures.
 */
export class CustomerApiTransport extends Context.Service<
  CustomerApiTransport,
  ICustomerApiTransport
>()("CustomerApiTransport") {}

type CustomerApiClient = Effect.Success<
  ReturnType<typeof makeWorkspaceCustomerApiClient>
>;

/** The typed Workspace customer API (`/api/customer`). */
export class CustomerApi extends Context.Service<
  CustomerApi,
  CustomerApiClient
>()("CustomerApi") {
  static Default = Layer.effect(
    this,
    Effect.flatMap(Effect.service(CustomerApiTransport), (transport) =>
      makeWorkspaceCustomerApiClient({
        baseUrl: transport.apiOrigin,
        transformClient: transport.customerApi,
      })
    )
  );
}

type CustomerAuthApiClient = Effect.Success<
  ReturnType<typeof makeCustomerAuthApiClient>
>;

/**
 * The Better Auth endpoints the account screens call directly: passkey
 * rename and delete, and assistant disconnect. Sign-in and sign-out stay
 * with the auth module.
 */
export class CustomerAuthApi extends Context.Service<
  CustomerAuthApi,
  CustomerAuthApiClient
>()("CustomerAuthApi") {
  static Default = Layer.effect(
    this,
    Effect.flatMap(Effect.service(CustomerApiTransport), (transport) =>
      makeCustomerAuthApiClient({
        baseUrl: transport.apiOrigin,
        transformClient: transport.customerAuthApi,
      })
    )
  );
}

interface ICustomerAccountScope {
  /** The signed-in account the runtime serves; it never changes inside one. */
  readonly accountId: string;
  /** When the session the runtime opened under started (epoch ms). */
  readonly sessionStartedAt: number;
  /** The Workspace origin, for keys that must not mix deployments. */
  readonly apiOrigin: string;
}

/** The account a data runtime belongs to. */
export class CustomerAccountScope extends Context.Service<
  CustomerAccountScope,
  ICustomerAccountScope
>()("CustomerAccountScope") {}

interface ICustomerSessionCheck {
  /**
   * Asks the auth state to read the session again. The sign-in guard
   * redirects only if the session is really gone.
   */
  readonly recheck: Effect.Effect<void>;
}

/** What the data layer does when the API answers 401. */
export class CustomerSessionCheck extends Context.Service<
  CustomerSessionCheck,
  ICustomerSessionCheck
>()("CustomerSessionCheck") {}
