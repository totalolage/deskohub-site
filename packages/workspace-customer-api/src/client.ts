import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import { HttpApiClient } from "effect/unstable/httpapi";
import { CustomerAuthApi } from "./customer-auth-api";
import { customerApiClientHeader } from "./customer-session";
import { WorkspaceCustomerApi } from "./workspace-customer-api";

export { customerApiClientHeader } from "./customer-session";

export type CustomerApiClientOptions = {
  /** The Workspace origin, such as `https://workspace.deskohub.cz`. */
  readonly baseUrl: URL | string;
  /**
   * Adapts the HTTP client the caller provides, for example to attach the
   * session cookie or retry transient failures.
   */
  readonly transformClient?: (
    client: HttpClient.HttpClient
  ) => HttpClient.HttpClient;
};

const withClientHeader = HttpClient.mapRequest(
  HttpClientRequest.setHeader(
    customerApiClientHeader.name,
    customerApiClientHeader.value
  )
);

// `mapRequest` appends to the request pipeline, so applying the header last
// sets it after every caller transform: none can drop or change it.
const clientTransform =
  (options: CustomerApiClientOptions) => (client: HttpClient.HttpClient) =>
    withClientHeader(
      options.transformClient ? options.transformClient(client) : client
    );

/**
 * A typed client of the Workspace customer API. Every request carries the
 * customer API client header. Requires an `HttpClient`, such as
 * `FetchHttpClient.layer`.
 */
export const makeWorkspaceCustomerApiClient = (
  options: CustomerApiClientOptions
) =>
  HttpApiClient.make(WorkspaceCustomerApi, {
    baseUrl: options.baseUrl,
    transformClient: clientTransform(options),
  });

/**
 * A typed client of the Better Auth endpoints the customer calls directly:
 * session, sign-out, passkey rename and delete, and assistant disconnect.
 * Requires an `HttpClient`.
 *
 * Better Auth refuses a cookie-authenticated mutation without a trusted
 * `Origin`; the customer API client header doesn't satisfy that check, so
 * the caller's client must send an origin Better Auth trusts.
 */
export const makeCustomerAuthApiClient = (options: CustomerApiClientOptions) =>
  HttpApiClient.make(CustomerAuthApi, {
    baseUrl: options.baseUrl,
    transformClient: clientTransform(options),
  });
