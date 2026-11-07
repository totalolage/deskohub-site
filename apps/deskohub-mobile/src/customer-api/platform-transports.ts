import { Effect, Layer } from "effect";
import { FetchHttpClient, HttpClient } from "effect/unstable/http";
import { CustomerApiTransport } from "./customer-api.service";
import { reportEachSend } from "./customer-request-dispatch";
import { retryTransientReads } from "./read-retry";
import { withNativeAuthOrigin, withSessionCookie } from "./session-cookie";

// The fetch adapter reads `RequestInit` from the fiber that sends the
// request, so the client sets it on each request rather than relying on the
// caller's context.
const withCredentials =
  (credentials: RequestCredentials) =>
  (client: HttpClient.HttpClient): HttpClient.HttpClient =>
    HttpClient.transform(client, (response) =>
      Effect.provideService(response, FetchHttpClient.RequestInit, {
        credentials,
      })
    );

export interface NativeTransportOptions {
  readonly apiOrigin: string;
  /** The stored session cookie header, `""` when there is none. */
  readonly readSessionCookie: Effect.Effect<string>;
}

/**
 * Native requests carry the stored cookie themselves, only to the API origin,
 * so the platform cookie jar is kept out (`credentials: "omit"`). Customer
 * API requests send no origin; Better Auth mutations send the trusted app
 * origin. Each send is reported to the running request (read budget, write
 * sent). Needs an `HttpClient`, such as `FetchHttpClient.layer`.
 */
export const nativeCustomerApiTransport = ({
  apiOrigin,
  readSessionCookie,
}: NativeTransportOptions) => {
  const sendWithSessionCookie = (
    client: HttpClient.HttpClient
  ): HttpClient.HttpClient =>
    withCredentials("omit")(
      HttpClient.mapRequestEffect(client, (request) =>
        Effect.map(readSessionCookie, (cookie) =>
          withSessionCookie(apiOrigin, cookie)(request)
        )
      )
    );
  return Layer.succeed(CustomerApiTransport, {
    apiOrigin,
    customerApi: (client) =>
      retryTransientReads(reportEachSend(sendWithSessionCookie(client))),
    customerAuthApi: (client) =>
      retryTransientReads(
        reportEachSend(
          HttpClient.mapRequest(
            sendWithSessionCookie(client),
            withNativeAuthOrigin(apiOrigin)
          )
        )
      ),
  });
};

/**
 * The web bundle is served by the Workspace itself, so the browser sends the
 * site's own same-origin cookie and origin; no headers are added.
 */
export const webCustomerApiTransport = ({
  apiOrigin,
}: {
  readonly apiOrigin: string;
}) => {
  const send = (client: HttpClient.HttpClient) =>
    retryTransientReads(reportEachSend(withCredentials("same-origin")(client)));
  return Layer.succeed(CustomerApiTransport, {
    apiOrigin,
    customerApi: send,
    customerAuthApi: send,
  });
};
