import { WorkspaceAdminApi } from "@deskohub/workspace-admin-api";
import { Context, Effect, Layer, Option, Redacted } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  type HttpClientResponse,
} from "effect/unstable/http";
import {
  type HttpApi,
  HttpApiClient,
  type HttpApiGroup,
} from "effect/unstable/httpapi";

/**
 * Serves one request with the administration API that administrators'
 * agents use: the server's handlers behind assistant authentication, never
 * mounted on a URL.
 */
export class AdministrationApiTransport extends Context.Service<
  AdministrationApiTransport,
  (request: Request) => Promise<Response>
>()(
  "@deskohub-workspace/administration-agent-tools/AdministrationApiTransport"
) {}

/** The OAuth access token of the agent an administration call acts for. */
export class AdministrationAgentAccessToken extends Context.Service<
  AdministrationAgentAccessToken,
  Redacted.Redacted<string>
>()(
  "@deskohub-workspace/administration-agent-tools/AdministrationAgentAccessToken"
) {}

/** One administration API request, with each part as its schema's type. */
export interface AdministrationApiRequest {
  readonly params?: unknown;
  readonly query?: unknown;
  readonly payload?: unknown;
}

/** An operation's decoded success and the content type it was sent with. */
interface AdministrationApiResponse {
  readonly value: unknown;
  readonly contentType: Option.Option<string>;
}

type EndpointCall = (
  request: AdministrationApiRequest & {
    readonly responseMode: "decoded-and-response";
  }
) => Effect.Effect<
  readonly [unknown, HttpClientResponse.HttpClientResponse],
  unknown,
  AdministrationAgentAccessToken
>;

interface IAdministrationApiClient {
  /**
   * Calls `<group>.<endpoint>` with the calling agent's access token. Fails
   * with the operation's typed error, or a transport or schema error.
   */
  readonly call: (
    operation: string,
    request: AdministrationApiRequest
  ) => Effect.Effect<
    AdministrationApiResponse,
    unknown,
    AdministrationAgentAccessToken
  >;
}

// The transport ignores the host; requests never leave the process.
const baseUrl = "https://administration.invalid";

/**
 * The administration API client administrators' agents call through: the
 * API's own client, over a fetch that hands each request to the transport,
 * so requests run the same handlers, schemas and errors as the CLI's.
 */
export class AdministrationApiClient extends Context.Service<
  AdministrationApiClient,
  IAdministrationApiClient
>()("@deskohub-workspace/administration-agent-tools/AdministrationApiClient") {
  /** A client of `api`, served by the transport. */
  static forApi = <Id extends string, Groups extends HttpApiGroup.Any>(
    api: HttpApi.HttpApi<Id, Groups>
  ) =>
    Layer.effect(
      AdministrationApiClient,
      Effect.gen(function* () {
        const transport = yield* AdministrationApiTransport;
        const fetch: typeof globalThis.fetch = Object.assign(
          (input: RequestInfo | URL, init?: RequestInit) =>
            transport(new Request(input, init)),
          { preconnect: globalThis.fetch.preconnect }
        );
        const httpClient = (yield* HttpClient.HttpClient).pipe(
          // The fetch client reads `Fetch` from the fiber that sends each
          // request, so the transport is pinned on every request here:
          // none of them may reach the network.
          HttpClient.transformResponse(
            Effect.provideService(FetchHttpClient.Fetch, fetch)
          ),
          HttpClient.mapRequestEffect(
            Effect.fn("AdministrationApiClient.authorize")(function* (
              request: HttpClientRequest.HttpClientRequest
            ) {
              const token = yield* AdministrationAgentAccessToken;
              return HttpClientRequest.bearerToken(
                request,
                Redacted.value(token)
              );
            })
          )
        );
        // The tools reach operations by name and check each request part
        // against the endpoint's schemas themselves.
        const client = (yield* HttpApiClient.makeWith(api, {
          httpClient,
          baseUrl,
        })) as Readonly<Record<string, Readonly<Record<string, EndpointCall>>>>;
        return {
          call: (operation, request) =>
            Option.fromNullishOr(
              client[operation.split(".")[0] ?? ""]?.[
                operation.split(".")[1] ?? ""
              ]
            ).pipe(
              Option.match({
                onNone: () =>
                  Effect.die(new Error(`Unknown operation ${operation}.`)),
                onSome: (call) =>
                  call({
                    ...request,
                    responseMode: "decoded-and-response",
                  }).pipe(
                    Effect.map(([value, response]) => ({
                      value,
                      contentType: Option.fromNullishOr(
                        response.headers["content-type"]
                      ),
                    }))
                  ),
              })
            ),
        } satisfies IAdministrationApiClient;
      })
    ).pipe(Layer.provide(FetchHttpClient.layer));

  static Default = this.forApi(WorkspaceAdminApi);
}
