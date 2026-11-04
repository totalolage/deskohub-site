import { describe, expect, test } from "bun:test";
import { Predicate, Schema } from "effect";
import {
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";
import { type ExternalAPIError, NetworkError } from "../errors";
import { mapNexiClientError } from "./api";

const request = HttpClientRequest.get("https://nexi.example.test/orders/1");

const responseWithStatus = (status: number) =>
  HttpClientResponse.fromWeb(request, new Response("{}", { status }));

const providerBody = {
  status: 422,
  message: "Provider rejected",
  errors: [{ description: "Invalid amount" }],
};

const expectExternalApiError = (error: ExternalAPIError | NetworkError) => {
  if (!Predicate.isTagged(error, "ExternalAPIError")) {
    throw new Error(`Expected ExternalAPIError, got ${error._tag}`);
  }
  return error;
};

const expectNetworkError = (error: ExternalAPIError | NetworkError) => {
  if (!Predicate.isTagged(error, "NetworkError")) {
    throw new Error(`Expected NetworkError, got ${error._tag}`);
  }
  return error;
};

describe("mapNexiClientError", () => {
  test("passes a network error through unchanged", () => {
    const error = new NetworkError({ message: "Failed to connect to Nexi" });

    expect(mapNexiClientError(error, "Get order")).toBe(error);
  });

  test("reports an undecodable response as an invalid provider response", () => {
    const schemaError = (() => {
      try {
        Schema.decodeUnknownSync(Schema.String)(1);
      } catch (error) {
        return error;
      }
    })();

    const error = expectExternalApiError(
      mapNexiClientError(schemaError, "Get order")
    );

    expect(error).toMatchObject({ service: "Nexi", operation: "Get order" });
    expect(error.statusCode).toBeUndefined();
    expect(error.message).toBe("Nexi returned an invalid response.");
  });

  test("reports transport and invalid URL failures as unreachable Nexi", () => {
    for (const reason of [
      new HttpClientError.TransportError({ request, description: "{}" }),
      new HttpClientError.InvalidUrlError({ request }),
    ]) {
      const failure = new HttpClientError.HttpClientError({ reason });

      const error = expectNetworkError(
        mapNexiClientError(failure, "Get order")
      );

      expect(error.url).toBe(request.url);
      expect(error.cause).toBe(failure);
    }
  });

  test("reads the provider error body from an HTTP status failure", () => {
    const failure = new HttpClientError.HttpClientError({
      reason: new HttpClientError.StatusCodeError({
        request,
        response: responseWithStatus(400),
        description: JSON.stringify(providerBody),
      }),
    });

    const error = expectExternalApiError(
      mapNexiClientError(failure, "Get order")
    );

    expect(error.statusCode).toBe(422);
    expect(error.message).toBe("Provider rejected");
    expect(error.cause).toEqual([{ description: "Invalid amount" }]);
  });

  test("keeps the response status and reason cause when an HTTP failure has no provider body", () => {
    const cause = new Error("body stream broke");
    for (const reason of [
      new HttpClientError.StatusCodeError({
        request,
        response: responseWithStatus(503),
        description: "Service Unavailable",
        cause,
      }),
      new HttpClientError.DecodeError({
        request,
        response: responseWithStatus(503),
        cause,
      }),
    ]) {
      const error = expectExternalApiError(
        mapNexiClientError(
          new HttpClientError.HttpClientError({ reason }),
          "Get order"
        )
      );

      expect(error.statusCode).toBe(503);
      expect(error.message).toBeUndefined();
      expect(error.cause).toBe(cause);
    }
  });

  test("uses the provider error code and the first error description when the body has no message", () => {
    const failure = new HttpClientError.HttpClientError({
      reason: new HttpClientError.StatusCodeError({
        request,
        response: responseWithStatus(409),
        description: JSON.stringify({ error: "DUPLICATE_ORDER" }),
      }),
    });
    const generated = {
      response: { status: 400 },
      cause: JSON.stringify({ errors: [{ description: "Bad order" }] }),
    };

    const codeOnly = expectExternalApiError(
      mapNexiClientError(failure, "Create hosted payment page")
    );
    const descriptionOnly = expectExternalApiError(
      mapNexiClientError(generated, "Get order")
    );

    expect(codeOnly.statusCode).toBe(409);
    expect(codeOnly.cause).toBe("DUPLICATE_ORDER");
    expect(codeOnly.message).toBeUndefined();
    expect(descriptionOnly.statusCode).toBe(400);
    expect(descriptionOnly.message).toBe("Bad order");
    expect(descriptionOnly.cause).toEqual([{ description: "Bad order" }]);
  });

  test("keeps a generated client failure's cause when it is not a provider body", () => {
    const cause = 42;

    const error = expectExternalApiError(
      mapNexiClientError({ response: { status: 502 }, cause }, "Get order")
    );

    expect(error.statusCode).toBe(502);
    expect(error.cause).toBe(cause);
    expect(error.message).toBeUndefined();
  });

  test("reports aborted, failed fetch, and refused connections as unreachable Nexi", () => {
    for (const failure of [
      Object.assign(new Error("The operation was aborted"), {
        name: "AbortError",
      }),
      new TypeError("fetch failed"),
      new Error("connect ECONNREFUSED 127.0.0.1:443"),
    ]) {
      const error = expectNetworkError(
        mapNexiClientError(failure, "Get order")
      );

      expect(error.cause).toBe(failure);
      expect(error.url).toBeUndefined();
    }
  });

  test("maps a plain provider body, defaulting its status to 500", () => {
    const withStatus = expectExternalApiError(
      mapNexiClientError(providerBody, "Get order")
    );
    const withoutStatus = expectExternalApiError(
      mapNexiClientError(JSON.stringify({ error: "E1" }), "Get order")
    );

    expect(withStatus.statusCode).toBe(422);
    expect(withStatus.message).toBe("Provider rejected");
    expect(withStatus.cause).toEqual([{ description: "Invalid amount" }]);
    expect(withoutStatus.statusCode).toBe(500);
    expect(withoutStatus.cause).toBe("E1");
  });

  test("keeps any other failure as the error cause without a status", () => {
    for (const failure of ["not json", null, new Error("other failure")]) {
      const error = expectExternalApiError(
        mapNexiClientError(failure, "List orders")
      );

      expect(error.operation).toBe("List orders");
      expect(error.statusCode).toBeUndefined();
      expect(error.cause).toBe(failure);
    }
  });
});
