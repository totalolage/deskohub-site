import { OpenApi } from "effect/unstable/httpapi";

/** A string header a handler always sets on a response. */
export interface ResponseHeaderDescription {
  readonly description: string;
}

/**
 * Adds headers a handler sets on one response status to the endpoint's
 * OpenAPI operation. An `HttpApiEndpoint` success schema describes only the
 * body, so a header such as a download's `Content-Disposition` is otherwise
 * missing from the document. Annotate the endpoint with
 * `.annotateMerge(responseHeaders(200, { ... }))`.
 */
export const responseHeaders = (
  status: number,
  headers: Readonly<Record<string, ResponseHeaderDescription>>
) =>
  OpenApi.annotations({
    transform: (operation) => {
      const response = operation.responses?.[status];
      if (response === undefined)
        throw new Error(
          `${operation.operationId} has no ${status} response to describe headers on`
        );
      return {
        ...operation,
        responses: {
          ...operation.responses,
          [status]: {
            ...response,
            headers: {
              ...response.headers,
              ...Object.fromEntries(
                Object.entries(headers).map(([name, { description }]) => [
                  name,
                  { description, required: true, schema: { type: "string" } },
                ])
              ),
            },
          },
        },
      };
    },
  });
