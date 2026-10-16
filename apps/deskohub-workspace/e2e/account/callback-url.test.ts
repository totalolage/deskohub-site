import { describe, expect, test } from "bun:test";
import {
  isCallbackFailureQuery,
  isExactCallbackUrlString,
} from "./callback-url";

const origin = "https://workspace.example";
const callback = `${origin}/en-US/auth/callback`;
const attempt = "550e8400-e29b-41d4-a716-446655440000";
const returnTo = "%2Fcs-CZ%2Fadmin%2Finvoices%3Fpage%3D2";

describe("callback URL grammar", () => {
  test.each([
    callback,
    `${callback}?attempt=${attempt}`,
    `${callback}?attempt=${attempt}&returnTo=${returnTo}`,
    `${callback}?returnTo=%2Fadmin`,
  ])("accepts %s", (url) => {
    expect(isExactCallbackUrlString(url, origin)).toBe(true);
  });

  test.each([
    `https://other.example/en-US/auth/callback?attempt=${attempt}`,
    `${origin}/cs-CZ/auth/callback`,
    `${callback}#fragment`,
    `${callback}?attempt=${attempt.toUpperCase()}`,
    `${callback}?attempt=${attempt}&attempt=${attempt}`,
    `${callback}?attempt=${attempt}&returnTo=%2Fadmin&returnTo=%2Fadmin`,
    `${callback}?returnTo=https%3A%2F%2Fevil.example%2Fadmin`,
    `${callback}?returnTo=%2F%2Fevil.example%2Fadmin`,
    `${callback}?returnTo=%2F%5Cevil.example%2Fadmin`,
    `${callback}?returnTo=javascript%3Aalert(1)`,
    `${callback}?returnTo=%2Fadmin%23fragment`,
    `${callback}?returnTo=`,
    `${callback}?attempt=${attempt}&next=%2Fadmin`,
    "not a url",
  ])("rejects %s", (url) => {
    expect(isExactCallbackUrlString(url, origin)).toBe(false);
  });

  test.each([
    "?error=INVALID_TOKEN",
    `?attempt=${attempt}&error=INVALID_TOKEN`,
    `?attempt=${attempt}&returnTo=${returnTo}&error=INVALID_TOKEN`,
  ])("accepts the failure query %s", (search) => {
    expect(isCallbackFailureQuery(search)).toBe(true);
  });

  test.each([
    "",
    `?attempt=${attempt}`,
    "?error=OTHER",
    "?error=INVALID_TOKEN&error=INVALID_TOKEN",
    "?error=INVALID_TOKEN&returnTo=%2F%2Fevil.example",
    "?error=INVALID_TOKEN&next=%2Fadmin",
  ])("rejects the failure query %s", (search) => {
    expect(isCallbackFailureQuery(search)).toBe(false);
  });
});
