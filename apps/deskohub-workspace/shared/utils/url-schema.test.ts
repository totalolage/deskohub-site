import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { urlStringSchema } from "./url-schema";

describe("urlStringSchema", () => {
  const decodeUrl = Schema.decodeUnknownSync(urlStringSchema);

  test("accepts absolute URLs without changing their representation", () => {
    const httpUrl = "https://example.com/path?query=value";
    const databaseUrl = "postgres://user:pass@localhost:5432/workspace";

    expect(decodeUrl(httpUrl)).toBe(httpUrl);
    expect(decodeUrl(databaseUrl)).toBe(databaseUrl);
  });

  test("rejects invalid and relative URLs", () => {
    expect(() => decodeUrl("not a URL")).toThrow();
    expect(() => decodeUrl("/relative/path")).toThrow();
  });
});
