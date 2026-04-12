import { Buffer } from "node:buffer";
import type {
  IncomingHttpHeaders,
  IncomingMessage,
  ServerResponse,
} from "node:http";
import { fileURLToPath } from "node:url";

import {
  assertProductionBuildReady,
  createPortalRequestHandler,
} from "../portal-server";

const appDirectory = fileURLToPath(new URL("..", import.meta.url));
const handleRequest = createPortalRequestHandler({
  appDirectory,
  isDevelopment: false,
});

await assertProductionBuildReady({
  appDirectory,
  isDevelopment: false,
});

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse
) {
  const webRequest = new Request(
    new URL(request.url ?? "/", getRequestOrigin(request)),
    {
      headers: toHeaders(request.headers),
      method: request.method ?? "GET",
    }
  );

  const webResponse = await handleRequest(webRequest);
  await writeNodeResponse(webResponse, response);
}

function getRequestOrigin(request: IncomingMessage) {
  const protocolHeader = getFirstHeaderValue(
    request.headers["x-forwarded-proto"]
  );
  const hostHeader = getFirstHeaderValue(request.headers.host);
  const protocol = protocolHeader ?? "https";
  const host = hostHeader ?? "localhost";

  return `${protocol}://${host}`;
}

function toHeaders(headers: IncomingHttpHeaders) {
  const requestHeaders = new Headers();

  for (const [headerName, headerValue] of Object.entries(headers)) {
    if (!headerValue) {
      continue;
    }

    if (Array.isArray(headerValue)) {
      for (const value of headerValue) {
        requestHeaders.append(headerName, value);
      }

      continue;
    }

    requestHeaders.set(headerName, headerValue);
  }

  return requestHeaders;
}

async function writeNodeResponse(
  webResponse: Response,
  response: ServerResponse
) {
  response.statusCode = webResponse.status;

  webResponse.headers.forEach((headerValue, headerName) => {
    response.setHeader(headerName, headerValue);
  });

  if (!webResponse.body) {
    response.end();
    return;
  }

  const bodyBuffer = Buffer.from(await webResponse.arrayBuffer());
  response.end(bodyBuffer);
}

function getFirstHeaderValue(headerValue: string | string[] | undefined) {
  if (Array.isArray(headerValue)) {
    return headerValue[0] ?? null;
  }

  return headerValue ?? null;
}
