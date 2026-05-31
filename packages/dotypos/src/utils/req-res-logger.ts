import { Effect } from "effect";
import type { Client } from "../generated/client";

export const injectReqResLogger = Effect.fn(function* (client: Client) {
  client.interceptors.request.use(async (request) => {
    await logRequest(request);
    return request;
  });

  client.interceptors.response.use(async (response, request) => {
    await logResponse(request, response);
    return response;
  });
});

const headersToRecord = (headers: Headers) =>
  Object.fromEntries(headers.entries());

const readBody = async (body: Body) => {
  const text = await body
    .text()
    .then((value) => value || undefined)
    .catch((error: unknown) => ({ readError: error }));

  if (typeof text !== "string") return text;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
};

const logRequest = async (request: Request) => {
  const requestBody = request.body
    ? await readBody(request.clone())
    : undefined;

  Effect.runSync(
    Effect.logDebug("Dotypos API request", {
      method: request.method,
      url: request.url,
      headers: headersToRecord(request.headers),
      body: requestBody,
    })
  );
};

const logResponse = async (request: Request, response: Response) => {
  const responseBody = response.body
    ? await readBody(response.clone())
    : undefined;

  Effect.runSync(
    Effect.logDebug("Dotypos API response", {
      method: request.method,
      url: request.url,
      requestHeaders: headersToRecord(request.headers),
      status: response.status,
      statusText: response.statusText,
      responseHeaders: headersToRecord(response.headers),
      body: responseBody,
    })
  );
};
