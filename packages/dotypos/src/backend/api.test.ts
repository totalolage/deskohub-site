import { describe, expect, test } from "bun:test";
import {
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";
import { DotyposWireFailure, toDotyposWireFailure } from "./api";

const request = HttpClientRequest.get("https://api.dotykacka.test/v2/x");
const response = (status: number) =>
  HttpClientResponse.fromWeb(request, new Response(null, { status }));

const fromAddressedRequest = (error: unknown) =>
  toDotyposWireFailure(error, { fromAccessToken: false });

describe("toDotyposWireFailure", () => {
  test("keeps an existing wire failure as it is", () => {
    const failure = new DotyposWireFailure({
      outcome: { kind: "transport" },
      fromAccessToken: true,
    });

    expect(fromAddressedRequest(failure)).toBe(failure);
  });

  test.each([
    ["TransportError", new HttpClientError.TransportError({ request })],
    ["InvalidUrlError", new HttpClientError.InvalidUrlError({ request })],
  ])("reads an HTTP client %s as a transport failure", (_, reason) => {
    const error = new HttpClientError.HttpClientError({ reason });

    expect(
      toDotyposWireFailure(error, { fromAccessToken: true })
    ).toMatchObject({
      outcome: { kind: "transport" },
      fromAccessToken: true,
      cause: error,
    });
  });

  test("reads an HTTP status error with its provider error body", () => {
    const error = new HttpClientError.HttpClientError({
      reason: new HttpClientError.StatusCodeError({
        request,
        response: response(409),
        description: JSON.stringify({ error: "conflict", code: 409 }),
      }),
    });
    const providerError = {
      error: "conflict",
      errorDescription: undefined,
      code: 409,
    };

    expect(fromAddressedRequest(error)).toMatchObject({
      outcome: { kind: "status", status: 409, providerError },
      fromAccessToken: false,
      cause: providerError,
    });
  });

  test("reads an HTTP status error without a usable body by its status alone", () => {
    const failure = fromAddressedRequest(
      new HttpClientError.HttpClientError({
        reason: new HttpClientError.StatusCodeError({
          request,
          response: response(503),
          description: "Service Unavailable",
        }),
      })
    );

    expect(failure.outcome).toEqual({
      kind: "status",
      status: 503,
      providerError: undefined,
    });
    expect(failure.cause).toBeUndefined();
  });

  test("reads a generated client error by its response status and body", () => {
    expect(
      fromAddressedRequest({
        response: response(422),
        cause: { error_description: "missing field" },
      }).outcome
    ).toEqual({
      kind: "status",
      status: 422,
      providerError: {
        error: undefined,
        errorDescription: "missing field",
        code: undefined,
      },
    });
    expect(
      fromAddressedRequest({ response: response(500), cause: 42 }).outcome
    ).toEqual({ kind: "status", status: 500, providerError: undefined });
  });

  test.each([
    [
      "an aborted request",
      Object.assign(new Error("x"), { name: "AbortError" }),
    ],
    ["a failed fetch", new TypeError("fetch failed")],
    ["a refused connection", new Error("connect ECONNREFUSED 127.0.0.1:443")],
  ])("reads %s as a transport failure", (_, error) => {
    expect(fromAddressedRequest(error)).toMatchObject({
      outcome: { kind: "transport" },
      cause: error,
    });
  });

  test("reads a thrown provider error body by its code, or as a server error", () => {
    expect(
      fromAddressedRequest(JSON.stringify({ error: "denied", code: 403 }))
        .outcome
    ).toMatchObject({ kind: "status", status: 403 });
    expect(fromAddressedRequest({ error: "broken" }).outcome).toMatchObject({
      kind: "status",
      status: 500,
      providerError: { error: "broken" },
    });
  });

  test.each([
    ["an unrelated error", new Error("Something else")],
    ["text that is not an error body", "not json"],
    ["an empty error body", {}],
    ["nothing", undefined],
  ])("reads %s as unreadable", (_, error) => {
    expect(fromAddressedRequest(error)).toMatchObject({
      outcome: { kind: "unreadable" },
      fromAccessToken: false,
      cause: error,
    });
  });
});
