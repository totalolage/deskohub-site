import { describe, expect, test } from "bun:test";
import {
  developmentPreviewAccess,
  previewAccessHeaders,
  withPreviewAccessCookie,
} from "./preview-access";

const secret = "synthetic-bypass-value-for-tests";

describe("developmentPreviewAccess", () => {
  test("is off outside a development build, even with a configured value", () => {
    expect(developmentPreviewAccess(false, secret)).toBeUndefined();
  });

  test("is off when nothing is configured", () => {
    expect(developmentPreviewAccess(true, undefined)).toBeUndefined();
    expect(developmentPreviewAccess(true, "")).toBeUndefined();
    expect(developmentPreviewAccess(true, "  ")).toBeUndefined();
  });

  test("keeps the configured value in a development build", () => {
    const access = developmentPreviewAccess(true, ` ${secret} `);
    expect(access).toBeDefined();
    expect(previewAccessHeaders(access)).toEqual({
      "x-vercel-protection-bypass": secret,
    });
  });

  test("never shows the value when printed", () => {
    const access = developmentPreviewAccess(true, secret);
    expect(String(access)).not.toContain(secret);
    expect(JSON.stringify(access)).not.toContain(secret);
  });
});

describe("previewAccessHeaders", () => {
  test("adds nothing without preview access", () => {
    expect(previewAccessHeaders(undefined)).toEqual({});
  });
});

describe("withPreviewAccessCookie", () => {
  const signInUrl =
    "https://preview.example.test/app/sign-in?native=1&state=abc";

  test("leaves the URL alone without preview access", () => {
    expect(withPreviewAccessCookie(signInUrl, undefined)).toBe(signInUrl);
  });

  test("asks Vercel to set its bypass cookie on the first load and keeps the other parameters", () => {
    const url = new URL(
      withPreviewAccessCookie(signInUrl, developmentPreviewAccess(true, secret))
    );
    expect(url.origin + url.pathname).toBe(
      "https://preview.example.test/app/sign-in"
    );
    expect(url.searchParams.get("native")).toBe("1");
    expect(url.searchParams.get("state")).toBe("abc");
    expect(url.searchParams.get("x-vercel-protection-bypass")).toBe(secret);
    expect(url.searchParams.get("x-vercel-set-bypass-cookie")).toBe("true");
  });
});
