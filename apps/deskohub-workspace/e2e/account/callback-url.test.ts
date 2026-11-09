import { describe, expect, test } from "bun:test";
import { encodeAuthCallbackReturn } from "@/features/account/routes";
import {
  isCallbackFailureQuery,
  isExactCallbackUrlString,
  signedInCallbackCopy,
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

  const czechCallback = `${origin}/cs-CZ/auth/callback`;
  const selection = "/cs-CZ/reservation/cowork?selection=synthetic-1";
  const czechLanding = { locale: "cs-CZ", returnTo: selection } as const;

  test.each([
    `${czechCallback}?return=${encoded(selection)}`,
    `${czechCallback}?attempt=${attempt}&return=${encoded(selection)}`,
    `${czechCallback}?return=${encoded(selection)}&attempt=${attempt}`,
  ])("accepts the exact Czech return %s", (url) => {
    expect(isExactCallbackUrlString(url, origin, czechLanding)).toBe(true);
  });

  test.each([
    czechCallback,
    `${czechCallback}?attempt=${attempt}`,
    `${czechCallback}?return=${encoded("/cs-CZ/reservation/cowork")}`,
    `${czechCallback}?return=${encoded("/cs-CZ/reservation/cowork?selection=synthetic-2")}`,
    `${czechCallback}?return=${encoded(selection)}&return=${encoded(selection)}`,
    `${czechCallback}?return=${encoded(selection)}&next=%2Fadmin`,
    `${czechCallback}?return=${encoded(selection)}#fragment`,
    `${callback}?return=${encoded(selection)}`,
  ])("rejects the Czech landing %s", (url) => {
    expect(isExactCallbackUrlString(url, origin, czechLanding)).toBe(false);
  });

  test("checks the Czech callback path without a return target", () => {
    expect(
      isExactCallbackUrlString(`${czechCallback}?attempt=${attempt}`, origin, {
        locale: "cs-CZ",
      })
    ).toBe(true);
    expect(
      isExactCallbackUrlString(`${callback}?attempt=${attempt}`, origin, {
        locale: "cs-CZ",
      })
    ).toBe(false);
  });

  test("rejects a return target the callback cannot encode", () => {
    expect(
      isExactCallbackUrlString(czechCallback, origin, {
        locale: "cs-CZ",
        returnTo: "/cs-CZ/rezervace-ř",
      })
    ).toBe(false);
  });

  test("words the signed-in card for the landing", () => {
    expect(signedInCallbackCopy({})).toEqual({
      label: "Loading sign-in…",
      title: "You are signed in",
      body: "Taking you to your account…",
    });
    expect(signedInCallbackCopy(czechLanding)).toEqual({
      label: "Načítání přihlášení…",
      title: "Přihlášení proběhlo",
      body: "Vracíme tě zpět. Dokončit můžeš přímo v tomto prohlížeči.",
    });
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
