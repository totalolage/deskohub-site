import { describe, expect, test } from "bun:test";
import { canonicalJson } from "./canonical-json";

describe("canonicalJson", () => {
  test("sorts object keys at every depth", () => {
    expect(canonicalJson({ b: 1, a: { d: [{ y: 2, x: 1 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[{"x":1,"y":2}]},"b":1}'
    );
  });

  test("drops undefined object values like JSON.stringify", () => {
    expect(canonicalJson({ a: undefined, b: "x" })).toBe('{"b":"x"}');
  });

  test("escapes strings and keys as JSON", () => {
    expect(canonicalJson({ 'q"': 'line\n"quote"' })).toBe(
      JSON.stringify({ 'q"': 'line\n"quote"' })
    );
  });
});
