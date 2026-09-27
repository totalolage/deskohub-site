import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import {
  AresLookupFailure,
  AresLookupService,
  isValidCzechCompanyIco,
} from "./service";

const aresCompanyUrl = (ico: string) =>
  `https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/${ico}`;

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

const runLookup = (ico: string, fetchImpl: FetchLike) =>
  Effect.gen(function* () {
    const service = yield* AresLookupService;
    return yield* service.lookup(ico);
  }).pipe(
    Effect.provide(
      AresLookupService.Default.pipe(Layer.provide(FetchHttpClient.layer))
    ),
    Effect.provideService(
      FetchHttpClient.Fetch,
      Object.assign(fetchImpl, { preconnect: () => {} })
    ),
    Effect.map((subject) => ({ kind: "found" as const, subject })),
    Effect.catch((failure: AresLookupFailure) =>
      Effect.succeed({ kind: "failure" as const, failure })
    ),
    Effect.runPromise
  );

const expectLookupFailure = (
  result: Awaited<ReturnType<typeof runLookup>>,
  reason: AresLookupFailure["reason"]
) => {
  expect(result.kind).toBe("failure");
  if (result.kind !== "failure") return;
  expect(result.failure).toBeInstanceOf(Error);
  expect(result.failure._tag).toBe("AresLookupFailure");
  expect(result.failure.reason).toBe(reason);
};

describe("Czech company ID validation", () => {
  test("accepts exactly eight digits with a valid mod-11 checksum", () => {
    expect(isValidCzechCompanyIco("00000019")).toBe(true);
    expect(isValidCzechCompanyIco("27082440")).toBe(true);
  });

  test("rejects a wrong check digit", () => {
    expect(isValidCzechCompanyIco("27082441")).toBe(false);
    expect(isValidCzechCompanyIco("00000010")).toBe(false);
  });

  test("rejects values that are not exactly eight digits", () => {
    expect(isValidCzechCompanyIco("1234567")).toBe(false);
    expect(isValidCzechCompanyIco("123456789")).toBe(false);
    expect(isValidCzechCompanyIco("1234567a")).toBe(false);
    expect(isValidCzechCompanyIco("")).toBe(false);
    expect(isValidCzechCompanyIco(" 27082440")).toBe(false);
  });
});

describe("AresLookupService", () => {
  test("requests the fixed ARES company endpoint over GET at the pinned base URL", async () => {
    let requestedUrl = "";
    let requestedMethod = "";
    const result = await runLookup("27082440", (input, init) => {
      requestedUrl = String(input);
      requestedMethod = init?.method ?? "GET";
      return Promise.resolve(
        Response.json({
          ico: "27082440",
          obchodniJmeno: "Synthetická testovací s.r.o.",
        })
      );
    });

    expect(result.kind).toBe("found");
    expect(requestedUrl).toBe(aresCompanyUrl("27082440"));
    expect(requestedUrl).toStartWith("https://ares.gov.cz/");
    expect(requestedMethod).toBe("GET");
    expect(result.kind === "found" && result.subject).toEqual({
      ico: "27082440",
      obchodniJmeno: "Synthetická testovací s.r.o.",
    });
  });

  test("rejects an invalid company ID before any provider request", async () => {
    let requests = 0;
    const result = await runLookup("1234567a", () => {
      requests += 1;
      return Promise.resolve(Response.json({}));
    });

    expectLookupFailure(result, "InvalidIco");
    expect(requests).toBe(0);
  });

  test("maps a missing company to the not-found failure", async () => {
    const result = await runLookup("27082440", () =>
      Promise.resolve(
        Response.json(
          { kod: "NENALEZENO", popis: "Zdroj nenalezen" },
          { status: 404 }
        )
      )
    );

    expectLookupFailure(result, "NotFound");
  });

  test("maps rate limiting and server errors to the unavailable failure", async () => {
    for (const status of [400, 401, 403, 429, 500, 503]) {
      const result = await runLookup("27082440", () =>
        Promise.resolve(new Response(null, { status }))
      );
      expectLookupFailure(result, "Unavailable");
    }
  });

  test("maps a network rejection to the unavailable failure", async () => {
    const result = await runLookup("27082440", () =>
      Promise.reject(new TypeError("network down"))
    );

    expectLookupFailure(result, "Unavailable");
  });

  test("maps a malformed or unexpected provider payload to the unavailable failure", async () => {
    const result = await runLookup("27082440", () =>
      Promise.resolve(
        Response.json({ obchodniJmeno: 42, unexpected: "payload" })
      )
    );

    expectLookupFailure(result, "Unavailable");
  });

  test("never leaks provider payload data into failure values", async () => {
    const result = await runLookup("27082440", () =>
      Promise.resolve(
        Response.json({
          ico: "27082440",
          obchodniJmeno: "   ",
          secretProviderField: "must-not-leak",
        })
      )
    );

    expectLookupFailure(result, "Unavailable");
    expect(JSON.stringify(result)).not.toContain("must-not-leak");
  });

  test("returns the generated raw provider record for a matching company", async () => {
    const result = await runLookup("27082440", () =>
      Promise.resolve(
        Response.json({
          ico: "27082440",
          obchodniJmeno: "  Synthetická testovací s.r.o. ",
          dic: "   ",
          sidlo: {
            nazevUlice: "  ",
            cisloDomovni: 123,
            cisloOrientacni: 4,
            cisloOrientacniPismeno: "a",
            nazevObce: " Praha ",
            kodStatu: " CZ ",
          },
        })
      )
    );

    expect(result).toEqual({
      kind: "found",
      subject: {
        ico: "27082440",
        obchodniJmeno: "  Synthetická testovací s.r.o. ",
        dic: "   ",
        sidlo: {
          nazevUlice: "  ",
          cisloDomovni: 123,
          cisloOrientacni: 4,
          cisloOrientacniPismeno: "a",
          nazevObce: " Praha ",
          kodStatu: " CZ ",
        },
      },
    });
  });

  test("maps a response for a different company ID to the unavailable failure", async () => {
    const result = await runLookup("27082440", () =>
      Promise.resolve(
        Response.json({
          ico: "00000019",
          obchodniJmeno: "Jiná synthetická organizace",
        })
      )
    );

    expectLookupFailure(result, "Unavailable");
  });

  test("maps a blank company name response to the unavailable failure", async () => {
    const result = await runLookup("27082440", () =>
      Promise.resolve(Response.json({ ico: "27082440", obchodniJmeno: "   " }))
    );

    expectLookupFailure(result, "Unavailable");
  });
});

describe("failure vocabulary", () => {
  test("lookup failures are genuine Errors tagged AresLookupFailure with the matching reason", async () => {
    const invalidIco = await runLookup("1234567a", () =>
      Promise.resolve(Response.json({}))
    );
    expect(invalidIco.kind).toBe("failure");
    if (invalidIco.kind !== "failure") return;
    expect(invalidIco.failure).toBeInstanceOf(Error);
    expect(invalidIco.failure._tag).toBe("AresLookupFailure");
    expect(invalidIco.failure.reason).toBe("InvalidIco");

    const notFound = await runLookup("27082440", () =>
      Promise.resolve(
        Response.json(
          { kod: "NENALEZENO", popis: "Zdroj nenalezen" },
          { status: 404 }
        )
      )
    );
    expect(notFound.kind).toBe("failure");
    if (notFound.kind !== "failure") return;
    expect(notFound.failure).toBeInstanceOf(Error);
    expect(notFound.failure._tag).toBe("AresLookupFailure");
    expect(notFound.failure.reason).toBe("NotFound");

    const unavailable = await runLookup("27082440", () =>
      Promise.reject(new TypeError("network down"))
    );
    expect(unavailable.kind).toBe("failure");
    if (unavailable.kind !== "failure") return;
    expect(unavailable.failure).toBeInstanceOf(Error);
    expect(unavailable.failure._tag).toBe("AresLookupFailure");
    expect(unavailable.failure.reason).toBe("Unavailable");
  });

  test("exposes exactly the closed low-cardinality reason vocabulary", () => {
    expect(new AresLookupFailure({ reason: "InvalidIco" }).reason).toBe(
      "InvalidIco"
    );
    expect(new AresLookupFailure({ reason: "NotFound" }).reason).toBe(
      "NotFound"
    );
    expect(new AresLookupFailure({ reason: "Unavailable" }).reason).toBe(
      "Unavailable"
    );
  });
});
