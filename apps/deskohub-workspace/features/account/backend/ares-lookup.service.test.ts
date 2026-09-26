import "@/shared/testing/workspace-test-env";

import { afterEach, describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import {
  type AresCompany,
  type AresLookupFailure,
  AresLookupService,
  aresCompanyLookupUrl,
  isValidCzechCompanyIco,
  toAresBusinessBillingDraft,
} from "./ares-lookup.service";

const originalFetch = globalThis.fetch;

const syntheticCompany: AresCompany = {
  ico: "27082440",
  obchodniJmeno: "Synthetická testovací s.r.o.",
  dic: "CZ27082440",
  sidlo: {
    ulice: "Testovací ulice",
    cisloDomovni: "123",
    cisloOrientacni: "4",
    obec: "Praha",
    psc: "11000",
    statKod: "CZ",
  },
};

const runLookup = (ico: string, fetchImpl: typeof globalThis.fetch) =>
  Effect.gen(function* () {
    const service = yield* AresLookupService;
    return yield* service.lookup(ico);
  }).pipe(
    Effect.provide(
      AresLookupService.Default.pipe(Layer.provide(FetchHttpClient.layer))
    ),
    Effect.provideService(FetchHttpClient.Fetch, fetchImpl),
    Effect.map((company) => ({ kind: "found" as const, company })),
    Effect.catch((failure: AresLookupFailure) =>
      Effect.succeed({ kind: "failure" as const, failure })
    ),
    Effect.runPromise
  );

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Czech company ID validation", () => {
  test("accepts exactly eight digits with a valid mod-11 checksum", () => {
    expect(isValidCzechCompanyIco("00000019")).toBe(true);
    expect(isValidCzechCompanyIco("27082440")).toBe(true);
  });

  test("rejects a wrong check digit", () => {
    expect(isValidCzechCompanyIco("27082441")).toBe(false);
  });

  test("rejects values that are not exactly eight digits", () => {
    expect(isValidCzechCompanyIco("1234567")).toBe(false);
    expect(isValidCzechCompanyIco("123456789")).toBe(false);
    expect(isValidCzechCompanyIco("1234567a")).toBe(false);
    expect(isValidCzechCompanyIco("")).toBe(false);
    expect(isValidCzechCompanyIco(" 27082440")).toBe(false);
  });
});

describe("ARES company mapping to billing draft fields", () => {
  test("maps the verified company into billing fields including the address", () => {
    expect(toAresBusinessBillingDraft(syntheticCompany)).toEqual({
      companyName: "Synthetická testovací s.r.o.",
      companyId: "27082440",
      vatId: "CZ27082440",
      addressLine1: "Testovací ulice 123/4",
      city: "Praha",
      zip: "11000",
      country: "CZ",
    });
  });

  test("omits absent optional values instead of returning empty strings", () => {
    const minimal: AresCompany = {
      ico: "00000019",
      obchodniJmeno: "Synthetická minimalní organizace",
    };
    expect(toAresBusinessBillingDraft(minimal)).toEqual({
      companyName: "Synthetická minimalní organizace",
      companyId: "00000019",
    });
  });

  test("builds the house number without an orientation number", () => {
    const withoutOrientation: AresCompany = {
      ...syntheticCompany,
      sidlo: { ...syntheticCompany.sidlo, cisloOrientacni: undefined },
    };
    expect(toAresBusinessBillingDraft(withoutOrientation).addressLine1).toBe(
      "Testovací ulice 123"
    );
  });

  test("omits a verified value that exceeds the billing field maximum instead of truncating", () => {
    const overlong = (length: number) => "X".repeat(length);
    expect(
      toAresBusinessBillingDraft({
        ico: "27082440",
        obchodniJmeno: overlong(201),
        dic: overlong(33),
        sidlo: {
          ulice: overlong(201),
          obec: overlong(101),
          psc: overlong(21),
        },
      })
    ).toEqual({ companyId: "27082440" });
  });

  test("omits an undetermined seat country instead of defaulting to Czechia", () => {
    const unknownSeat: AresCompany = {
      ico: "27082440",
      obchodniJmeno: "Synthetická neurčitá organizace",
      sidlo: { obec: "Praha" },
    };
    const draft = toAresBusinessBillingDraft(unknownSeat);
    expect(draft.country).toBeUndefined();
    expect(draft.city).toBe("Praha");
    expect(draft.companyName).toBe("Synthetická neurčitá organizace");
  });

  test("maps a non-Czech seat to no country code", () => {
    const foreign: AresCompany = {
      ico: "27082440",
      obchodniJmeno: "Synthetická zahraniční organizace",
      sidlo: { obec: "Bratislava", statKod: "SK" },
    };
    expect(toAresBusinessBillingDraft(foreign).country).toBeUndefined();
  });

  test("omits a blank seat-country code instead of defaulting to Czechia", () => {
    const blankSeat: AresCompany = {
      ico: "27082440",
      obchodniJmeno: "Synthetická prázdná organizace",
      sidlo: { obec: "Praha", statKod: "  " },
    };
    expect(toAresBusinessBillingDraft(blankSeat).country).toBeUndefined();
  });
});

describe("ARES lookup service", () => {
  test("requests the fixed ARES company endpoint over GET", async () => {
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
    expect(requestedUrl).toBe(aresCompanyLookupUrl("27082440"));
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
      Promise.resolve(new Response(null, { status: 404 }))
    );

    expect(result).toEqual({ kind: "failure", failure: { _tag: "NotFound" } });
  });

  test("maps rate limiting and server errors to the unavailable failure", async () => {
    for (const status of [429, 500, 503]) {
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

  test("omits whitespace-only optional values and trims the rest of the decoded company", async () => {
    const result = await runLookup("27082440", () =>
      Promise.resolve(
        Response.json({
          ico: " 27082440 ",
          obchodniJmeno: "  Synthetická testovací s.r.o. ",
          dic: "   ",
          sidlo: {
            nazevUlice: "  ",
            cisloDomovni: " 123 ",
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
          obec: "Praha",
          statKod: "CZ",
        },
      },
    });
    expect(
      result.kind === "found" && toAresBusinessBillingDraft(result.company)
    ).toEqual({
      companyName: "Synthetická testovací s.r.o.",
      companyId: "27082440",
      addressLine1: "123",
      city: "Praha",
      country: "CZ",
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
