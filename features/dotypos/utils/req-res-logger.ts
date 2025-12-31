import { Effect } from "effect";
import type { Client } from "../generated/client";

export const injectReqResLogger = Effect.fn(function* (client: Client) {
  const pendingRequests = new Map<string, Request>();
  const logRequest = (request: Request) => {
    pendingRequests.set(request.url, request);
  };
  const logResponse = function* (response: Response) {
    const request = pendingRequests.get(response.url);
    if (!request) return;
    pendingRequests.delete(request.url);
    const auth = request.headers.get("Authorization");
    yield* Effect.logDebug(request.method, request.url, {
      status: response.status,
      statusText: response.statusText,
      requestHeaders: {
        ...request.headers,
        ...(auth && {
          Authorization: `${auth.split(" ")[0]} [REDACTED]`,
        }),
      },
      responseHeaders: response.headers,
    });
  };

  client.interceptors.request.use((request) => {
    logRequest(request);
    return request;
  });
  client.interceptors.response.use((response) => {
    logResponse(response);
    return response;
  });
});
