import { describe, expect, test } from "bun:test";
import { encodeAuthCallbackReturn } from "@/features/account/routes";
import {
  isCallbackFailureQuery,
  isExactCallbackUrlString,
} from "./callback-url";

const origin = "https://workspace.example";
const callback = `${origin}/en-US/auth/callback`;
const attempt = "550e8400-e29b-41d4-a716-446655440000";
const encoded = (path: string) => encodeAuthCallbackReturn(path) ?? "";
const returnTo = encoded("/cs-CZ/admin/invoices?page=2");

describe("callback URL grammar", () => {
  test.each([
    callback,
    `${callback}?attempt=${attempt}`,
    `${callback}?attempt=${attempt}&return=${returnTo}`,
    `${callback}?return=${encoded("/admin")}`,
  ])("accepts %s", (url) => {
    expect(isExactCallbackUrlString(url, origin)).toBe(true);
  });

  test.each([
    `https://other.example/en-US/auth/callback?attempt=${attempt}`,
    `${origin}/cs-CZ/auth/callback`,
    `${callback}#fragment`,
    `${callback}?attempt=${attempt.toUpperCase()}`,
    `${callback}?attempt=${attempt}&attempt=${attempt}`,
    `${callback}?attempt=${attempt}&return=${returnTo}&return=${returnTo}`,
    `${callback}?return=${encoded("https://evil.example/admin")}`,
    `${callback}?return=${encoded("//evil.example/admin")}`,
    `${callback}?return=${encoded("/\\evil.example/admin")}`,
    `${callback}?return=${encoded("javascript:alert(1)")}`,
    `${callback}?return=${encoded("/admin#fragment")}`,
    `${callback}?return=${encoded("/x/../admin")}`,
    `${callback}?return=%2Fadmin`,
    `${callback}?returnTo=%2Fadmin`,
    `${callback}?return=`,
    `${callback}?attempt=${attempt}&next=%2Fadmin`,
    "not a url",
  ])("rejects %s", (url) => {
    expect(isExactCallbackUrlString(url, origin)).toBe(false);
  });

  test.each([
    "?error=INVALID_TOKEN",
    `?attempt=${attempt}&error=INVALID_TOKEN`,
    `?attempt=${attempt}&return=${returnTo}&error=INVALID_TOKEN`,
  ])("accepts the failure query %s", (search) => {
    expect(isCallbackFailureQuery(search)).toBe(true);
  });

  test.each([
    "",
    `?attempt=${attempt}`,
    "?error=OTHER",
    "?error=INVALID_TOKEN&error=INVALID_TOKEN",
    `?error=INVALID_TOKEN&return=${encoded("//evil.example")}`,
    "?error=INVALID_TOKEN&next=%2Fadmin",
  ])("rejects the failure query %s", (search) => {
    expect(isCallbackFailureQuery(search)).toBe(false);
  });
});
