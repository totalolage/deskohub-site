import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import {
  AresLookupFailure,
  type AresLookupFailure as AresLookupFailureType,
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
    Effect.map((company) => ({ kind: "found" as const, company })),
    Effect.catch((failure: AresLookupFailureType) =>
      Effect.succeed({ kind: "failure" as const, failure })
    ),
    Effect.runPromise
  );

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
    expect(result.kind === "found" && result.company).toEqual({
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

    expect(result).toEqual({
      kind: "failure",
      failure: { _tag: "InvalidIco" },
    });
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

    expect(result).toEqual({ kind: "failure", failure: { _tag: "NotFound" } });
  });

  test("maps rate limiting and server errors to the unavailable failure", async () => {
    for (const status of [400, 401, 403, 429, 500, 503]) {
      const result = await runLookup("27082440", () =>
        Promise.resolve(new Response(null, { status }))
      );
      expect(result).toEqual({
        kind: "failure",
        failure: { _tag: "Unavailable" },
      });
    }
  });

  test("maps a network rejection to the unavailable failure", async () => {
    const result = await runLookup("27082440", () =>
      Promise.reject(new TypeError("network down"))
    );

    expect(result).toEqual({
      kind: "failure",
      failure: { _tag: "Unavailable" },
    });
  });

  test("maps a malformed or unexpected provider payload to the unavailable failure", async () => {
    const result = await runLookup("27082440", () =>
      Promise.resolve(
        Response.json({ obchodniJmeno: 42, unexpected: "payload" })
      )
    );

    expect(result).toEqual({
      kind: "failure",
      failure: { _tag: "Unavailable" },
    });
  });

  test("never leaks provider payload data into failure values", async () => {
    const result = await runLookup("27082440", () =>
      Promise.resolve(
        Response.json({
          ico: "27082440",
          obchodniJmeno: "Synthetická testovací s.r.o.",
          secretProviderField: "must-not-leak",
        })
      )
    );

    expect(JSON.stringify(result)).not.toContain("must-not-leak");
  });

  test("omits whitespace-only optional values and normalizes seat numbers", async () => {
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
      company: {
        ico: "27082440",
        obchodniJmeno: "Synthetická testovací s.r.o.",
        sidlo: {
          cisloDomovni: "123",
          cisloOrientacni: "4a",
          obec: "Praha",
          statKod: "CZ",
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

    expect(result).toEqual({
      kind: "failure",
      failure: { _tag: "Unavailable" },
    });
  });

  test("maps a blank company name response to the unavailable failure", async () => {
    const result = await runLookup("27082440", () =>
      Promise.resolve(Response.json({ ico: "27082440", obchodniJmeno: "   " }))
    );

    expect(result).toEqual({
      kind: "failure",
      failure: { _tag: "Unavailable" },
    });
  });
});

describe("failure vocabulary", () => {
  test("exposes exactly the three neutral outcome tags", () => {
    expect(AresLookupFailure.InvalidIco()._tag).toBe("InvalidIco");
    expect(AresLookupFailure.NotFound()._tag).toBe("NotFound");
    expect(AresLookupFailure.Unavailable()._tag).toBe("Unavailable");
  });
});
