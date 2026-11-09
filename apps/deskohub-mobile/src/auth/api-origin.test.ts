import { describe, expect, test } from "bun:test";
import { productionApiOrigin, resolveApiOrigin } from "./api-origin";

describe("resolveApiOrigin", () => {
  test("uses the production host when nothing is configured", () => {
    expect(resolveApiOrigin(undefined, undefined)).toBe(productionApiOrigin);
    expect(resolveApiOrigin("", undefined)).toBe(productionApiOrigin);
  });

  test("prefers the configured origin over the serving origin", () => {
    expect(
      resolveApiOrigin(
        "https://deskohub-workspace-site-abc.vercel.app/",
        "http://localhost:8081"
      )
    ).toBe("https://deskohub-workspace-site-abc.vercel.app");
  });

  test("falls back to the serving origin on web", () => {
    expect(resolveApiOrigin(undefined, "https://workspace.deskohub.cz")).toBe(
      "https://workspace.deskohub.cz"
    );
  });

  test("keeps only the origin of a configured URL", () => {
    expect(resolveApiOrigin("https://example.test/api/auth", undefined)).toBe(
      "https://example.test"
    );
  });

  test("accepts plain http only for loopback and emulator hosts", () => {
    expect(resolveApiOrigin("http://localhost:3000", undefined)).toBe(
      "http://localhost:3000"
    );
    expect(resolveApiOrigin("http://10.0.2.2:3000", undefined)).toBe(
      "http://10.0.2.2:3000"
    );
    expect(() => resolveApiOrigin("http://example.test", undefined)).toThrow();
  });

  test("rejects a value that is not an http(s) URL", () => {
    expect(() =>
      resolveApiOrigin("workspace.deskohub.cz", undefined)
    ).toThrow();
    expect(() => resolveApiOrigin("deskohub://account", undefined)).toThrow();
  });
});
