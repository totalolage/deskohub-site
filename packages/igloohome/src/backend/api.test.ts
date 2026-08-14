import { describe, expect, mock, test } from "bun:test";
import { Effect, Layer, Schema } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { IgloohomeRuntimeConfig } from "../config";
import { IgloohomeRequestError } from "../errors";
import { IgloohomeDeviceIdSchema } from "../types";
import { IgloohomeAccessToken, mapAlgoPinRequestError } from "./api";
import { IgloohomeService } from "./service";

const getRequest = (input: RequestInfo | URL, init?: RequestInit) =>
  input instanceof Request ? input : new Request(input, init);

describe("mapAlgoPinRequestError", () => {
  test("only treats documented precondition responses as definitive rejection", () => {
    for (const status of [400, 401, 403, 404, 415]) {
      expect(mapAlgoPinRequestError({ response: { status } }).outcome).toBe(
        "rejected"
      );
    }

    for (const status of [408, 425, 429, 499, 500, 503]) {
      expect(mapAlgoPinRequestError({ response: { status } }).outcome).toBe(
        "ambiguous"
      );
    }
  });

  test("preserves an already classified request error", () => {
    const error = new IgloohomeRequestError({
      operation: "authenticate",
      outcome: "rejected",
      message: "authentication failed",
    });

    expect(mapAlgoPinRequestError(error)).toBe(error);
  });

  test("does not retain a provider response payload in the public error", () => {
    const error = mapAlgoPinRequestError({
      response: { status: 500 },
      body: { pin: "987654321" },
    });

    expect(JSON.stringify(error)).not.toContain("987654321");
  });
});

describe("IgloohomeService", () => {
  test("authenticates and issues an hourly AlgoPIN with the documented request", async () => {
    const requests: Request[] = [];
    const fetchMock = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = getRequest(input, init);
        requests.push(request.clone());

        if (request.url === "https://auth.example.test/oauth2/token") {
          return Response.json({
            access_token: "access-token",
            expires_in: 3600,
          });
        }
        if (
          request.url ===
          "https://api.example.test/igloohome/devices/EK1X16f8898a/algopin/hourly"
        ) {
          return Response.json({ pin: "7654321", pinId: "pin-id" });
        }
        return new Response(null, { status: 404 });
      }
    ) as unknown as typeof globalThis.fetch;
    const httpClientLayer = FetchHttpClient.layer.pipe(
      Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetchMock))
    );
    const serviceLayer = IgloohomeService.Default.pipe(
      Layer.provide(IgloohomeAccessToken.Default),
      Layer.provide(
        Layer.merge(
          Layer.succeed(IgloohomeRuntimeConfig, {
            apiUrl: "https://api.example.test/igloohome",
            authUrl: "https://auth.example.test",
            clientId: "client-id",
            clientSecret: "client-secret",
            apiTimeout: 1000,
          }),
          httpClientLayer
        )
      )
    );

    const result = await Effect.gen(function* () {
      const service = yield* IgloohomeService;
      return yield* service.issueHourlyAlgoPin({
        deviceId: Schema.decodeUnknownSync(IgloohomeDeviceIdSchema)(
          "EK1X16f8898a"
        ),
        startsAt: "2026-08-13T09:00:00+02:00",
        endsAt: "2026-08-13T17:00:00+02:00",
        accessName: "Deskohub reservation-id",
      });
    }).pipe(Effect.provide(serviceLayer), Effect.runPromise);

    expect(String(result.pin)).toBe("7654321");
    expect(String(result.pinId)).toBe("pin-id");
    expect(requests).toHaveLength(2);

    const authRequest = requests[0] as Request;
    expect(authRequest.method).toBe("POST");
    expect(authRequest.headers.get("authorization")).toBe(
      `Basic ${Buffer.from("client-id:client-secret").toString("base64")}`
    );
    expect(
      Object.fromEntries(new URLSearchParams(await authRequest.text()))
    ).toEqual({
      grant_type: "client_credentials",
      scope: "igloohomeapi/algopin-hourly",
    });

    const issueRequest = requests[1] as Request;
    expect(issueRequest.method).toBe("POST");
    expect(issueRequest.headers.get("authorization")).toBe(
      "Bearer access-token"
    );
    expect(await issueRequest.json()).toEqual({
      variance: 1,
      startDate: "2026-08-13T09:00:00+02:00",
      endDate: "2026-08-13T17:00:00+02:00",
      accessName: "Deskohub reservation-id",
    });
  });
});
