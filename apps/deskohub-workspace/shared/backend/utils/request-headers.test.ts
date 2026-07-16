import "@/shared/testing/workspace-test-env";

import { expect, mock, test } from "bun:test";
import { Effect } from "effect";

const getNextHeaders = mock(() =>
  Promise.resolve(new Headers({ referer: "https://deskohub.test/en-US" }))
);

mock.module("next/headers", () => ({ headers: getNextHeaders }));

test("loads the current request headers through the Effect error channel", async () => {
  const { getRequestHeaders } = await import("./request-headers");

  const requestHeaders = await Effect.runPromise(getRequestHeaders());

  expect(requestHeaders.get("referer")).toBe("https://deskohub.test/en-US");
});

test("preserves request header failures as the error cause", async () => {
  const cause = new Error("request context unavailable");
  getNextHeaders.mockImplementationOnce(() => Promise.reject(cause));
  const { getRequestHeaders, RequestHeadersError } = await import(
    "./request-headers"
  );

  const error = await Effect.runPromise(getRequestHeaders().pipe(Effect.flip));

  expect(error).toBeInstanceOf(RequestHeadersError);
  expect(error.cause).toBe(cause);
});
