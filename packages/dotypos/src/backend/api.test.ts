import { afterEach, describe, expect, mock, test } from "bun:test";
import { Effect } from "effect";
import { makeDotyposRuntimeConfigLayer } from "../config";
import { DotyposApi } from "./api";

const config = {
  clientId: "client-id",
  clientSecret: "client-secret",
  refreshToken: "refresh-token",
  cloudId: "cloud-id",
  branchId: "branch-id",
  employeeId: "employee-id",
  apiUrl: "https://dotypos.example.test",
  apiTimeout: 1000,
  reservationTableIds: ["table-id"],
};

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const runWithApi = <A, E>(effect: Effect.Effect<A, E, DotyposApi>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(DotyposApi.Default),
      Effect.provide(makeDotyposRuntimeConfigLayer(config))
    )
  );

const mockDotyposFetch = (responses: {
  readonly reservations?: Response;
  readonly tables?: Response;
}) => {
  const fetchMock = mock(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = input instanceof Request ? input.url : String(input);
      const method =
        init?.method ?? (input instanceof Request ? input.method : "GET");

      if (method === "POST" && url.endsWith("/signin/token")) {
        return Response.json({ accessToken: "access-token" }, { status: 201 });
      }

      if (url.includes("/reservations")) {
        return responses.reservations ?? Response.json({ data: [] });
      }

      if (url.includes("/tables")) {
        return responses.tables ?? Response.json({ data: [] });
      }

      return Response.json({ error: "Unexpected request" }, { status: 500 });
    }
  );

  globalThis.fetch = Object.assign(fetchMock, {
    preconnect: originalFetch.preconnect,
  });
  return fetchMock;
};

describe("DotyposApi listReservations", () => {
  test("treats Dotypos empty-collection 404 as no reservations", async () => {
    const fetchMock = mockDotyposFetch({
      reservations: new Response("", {
        status: 404,
        statusText: "Not Found",
      }),
    });

    const result = await runWithApi(
      Effect.gen(function* () {
        const api = yield* DotyposApi;
        return yield* api.listReservations({
          path: { cloudId: config.cloudId },
          query: { limit: 100 },
        });
      })
    );

    expect(result).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("DotyposApi error mapping", () => {
  test("preserves HTTP status for generated SDK errors", async () => {
    mockDotyposFetch({
      tables: new Response("", {
        status: 404,
        statusText: "Not Found",
      }),
    });

    const result = await runWithApi(
      Effect.gen(function* () {
        const api = yield* DotyposApi;
        return yield* api
          .getTables({ path: { cloudId: config.cloudId } })
          .pipe(Effect.either);
      })
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left).toMatchObject({
        _tag: "ExternalAPIError",
        service: "Dotypos",
        operation: "Get tables",
        statusCode: 404,
      });
    }
  });
});
