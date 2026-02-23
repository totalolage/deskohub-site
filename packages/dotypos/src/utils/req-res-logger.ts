import { Effect } from "effect";
import type { Client } from "../generated/client";

export const injectReqResLogger = Effect.fn(function* (client: Client) {
  const pendingRequests = new Map<string, Request>();

  client.interceptors.request.use((request) => {
    pendingRequests.set(request.url, request);
    return request;
  });

  client.interceptors.response.use((response) => {
    const request = pendingRequests.get(response.url);
    if (!request) return response;

    pendingRequests.delete(request.url);
    const auth = request.headers.get("Authorization");
    Effect.runSync(
      Effect.logDebug(request.method, request.url, {
        status: response.status,
        statusText: response.statusText,
        requestHeaders: {
          ...request.headers,
          ...(auth && {
            Authorization: `${auth.split(" ")[0]} [REDACTED]`,
          }),
        },
        responseHeaders: response.headers,
      })
    );

    return response;
  });
});
