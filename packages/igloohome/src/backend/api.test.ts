import { describe, expect, mock, test } from "bun:test";
import { Cause, Effect, Exit, Layer, Option, Schema } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { IgloohomeRuntimeConfig } from "../config";
import { IgloohomeRequestError } from "../errors";
import type { IssueHourlyAlgoPinInput } from "../types";
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
  const recordRequests = (requests: Request[]) =>
    mock(async (input: RequestInfo | URL, init?: RequestInit) => {
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
    }) as unknown as typeof globalThis.fetch;

  const buildServiceLayer = (
    fetchMock: typeof globalThis.fetch,
    apiTimeout = 1_000
  ) => {
    const httpClientLayer = FetchHttpClient.layer.pipe(
      Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetchMock))
    );
    return IgloohomeService.Default.pipe(
      Layer.provide(IgloohomeAccessToken.Default),
      Layer.provide(
        Layer.merge(
          Layer.succeed(IgloohomeRuntimeConfig, {
            apiUrl: "https://api.example.test/igloohome",
            authUrl: "https://auth.example.test",
            clientId: "client-id",
            clientSecret: "client-secret",
            apiTimeout,
          }),
          httpClientLayer
        )
      )
    );
  };

  const deviceId = Schema.decodeUnknownSync(IgloohomeDeviceIdSchema)(
    "EK1X16f8898a"
  );

  test("authenticates and issues an hourly AlgoPIN with the documented request", async () => {
    const requests: Request[] = [];
    const result = await Effect.gen(function* () {
      const service = yield* IgloohomeService;
      return yield* service.issueHourlyAlgoPin({
        deviceId,
        variance: 1,
        startsAt: "2026-08-13T09:00:00+02:00",
        endsAt: "2026-08-13T17:00:00+02:00",
        accessName: "Deskohub reservation-id",
      });
    }).pipe(
      Effect.provide(buildServiceLayer(recordRequests(requests))),
      Effect.runPromise
    );

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

  test("forwards the caller's variance policy to the provider request", async () => {
    const requests: Request[] = [];
    const result = await Effect.gen(function* () {
      const service = yield* IgloohomeService;
      return yield* service.issueHourlyAlgoPin({
        deviceId,
        variance: 3,
        startsAt: "2026-08-13T09:00:00+02:00",
        endsAt: "2026-08-13T17:00:00+02:00",
        accessName: "Deskohub standalone",
      });
    }).pipe(
      Effect.provide(buildServiceLayer(recordRequests(requests))),
      Effect.runPromise
    );

    expect(String(result.pin)).toBe("7654321");
    const issueRequest = requests[1] as Request;
    expect(await issueRequest.json()).toMatchObject({ variance: 3 });

    const outsideVariance = {
      deviceId,
      variance: 4,
      startsAt: "2026-08-13T09:00:00+02:00",
      endsAt: "2026-08-13T17:00:00+02:00",
      accessName: "Deskohub standalone",
    };
    // @ts-expect-error the provider interface only accepts variance 1, 2, or 3.
    const rejected: IssueHourlyAlgoPinInput = outsideVariance;
    void rejected;
  });

  test("interrupts a delayed authentication before any AlgoPIN request can follow", async () => {
    const requests: Request[] = [];
    const abortSignals: AbortSignal[] = [];
    let completeAuthentication: ((response: Response) => void) | undefined;
    const fetchMock = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = getRequest(input, init);
        requests.push(request.clone());
        abortSignals.push(request.signal);
        if (request.url === "https://auth.example.test/oauth2/token") {
          return await new Promise<Response>((resolve) => {
            completeAuthentication = resolve;
          });
        }
        return Response.json({ pin: "7654321", pinId: "pin-id" });
      }
    ) as unknown as typeof globalThis.fetch;

    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const service = yield* IgloohomeService;
        return yield* service.issueHourlyAlgoPin({
          deviceId,
          variance: 1,
          startsAt: "2026-08-13T09:00:00+02:00",
          endsAt: "2026-08-13T17:00:00+02:00",
          accessName: "Deskohub reservation-id",
        });
      }).pipe(Effect.provide(buildServiceLayer(fetchMock, 40)))
    );

    const failure = Exit.isFailure(exit)
      ? Option.getOrUndefined(Cause.findErrorOption(exit.cause))
      : undefined;
    expect(failure).toBeInstanceOf(IgloohomeRequestError);
    expect(failure?.operation).toBe("authenticate");
    expect(failure?.outcome).toBe("rejected");

    completeAuthentication?.(
      Response.json({ access_token: "late-token", expires_in: 3600 })
    );
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(requests).toHaveLength(1);
    expect(abortSignals[0]?.aborted).toBe(true);
  });

  test("aborts a stalled authentication body and blocks any later AlgoPIN request", async () => {
    const requests: Request[] = [];
    let completeBody: (() => void) | undefined;
    let bodyCancelled = false;
    const fetchMock = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = getRequest(input, init);
        requests.push(request.clone());
        if (request.url === "https://auth.example.test/oauth2/token") {
          const encoder = new TextEncoder();
          const body = new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(encoder.encode('{"access_'));
              completeBody = () => {
                if (bodyCancelled) return;
                controller.enqueue(encoder.encode('token":"late-token"}'));
                controller.close();
              };
            },
            cancel: () => {
              bodyCancelled = true;
            },
          });
          return new Response(body, {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return Response.json({ pin: "7654321", pinId: "pin-id" });
      }
    ) as unknown as typeof globalThis.fetch;

    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const service = yield* IgloohomeService;
        return yield* service.issueHourlyAlgoPin({
          deviceId,
          variance: 1,
          startsAt: "2026-08-13T09:00:00+02:00",
          endsAt: "2026-08-13T17:00:00+02:00",
          accessName: "Deskohub reservation-id",
        });
      }).pipe(Effect.provide(buildServiceLayer(fetchMock, 40)))
    );

    const failure = Exit.isFailure(exit)
      ? Option.getOrUndefined(Cause.findErrorOption(exit.cause))
      : undefined;
    expect(failure).toBeInstanceOf(IgloohomeRequestError);
    expect(failure?.operation).toBe("authenticate");
    expect(failure?.outcome).toBe("rejected");

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(bodyCancelled).toBe(true);

    completeBody?.();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(requests).toHaveLength(1);
  });

  test("bounds delayed authentication and delayed creation below twice the per-request timeout", async () => {
    const requests: Request[] = [];
    const apiTimeout = 200;
    const phaseDelayMilliseconds = 150;
    const fetchMock = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = getRequest(input, init);
        requests.push(request.clone());
        await new Promise((resolve) =>
          setTimeout(resolve, phaseDelayMilliseconds)
        );
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

    const startedAt = Date.now();
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* IgloohomeService;
        return yield* service.issueHourlyAlgoPin({
          deviceId,
          variance: 1,
          startsAt: "2026-08-13T09:00:00+02:00",
          endsAt: "2026-08-13T17:00:00+02:00",
          accessName: "Deskohub reservation-id",
        });
      }).pipe(Effect.provide(buildServiceLayer(fetchMock, apiTimeout)))
    );

    expect(String(result.pin)).toBe("7654321");
    expect(requests).toHaveLength(2);
    const elapsedMilliseconds = Date.now() - startedAt;
    expect(elapsedMilliseconds).toBeGreaterThanOrEqual(
      2 * phaseDelayMilliseconds
    );
    expect(elapsedMilliseconds).toBeLessThan(2 * apiTimeout + 100);
  });
});
