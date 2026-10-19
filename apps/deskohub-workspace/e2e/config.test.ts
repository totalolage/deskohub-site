import { expect, test } from "bun:test";
import { parseWorkspaceE2EBaseUrl } from "./config";
import { assertSafeDatabaseUrl } from "./runtime";

test("parses an immutable HTTPS Vercel deployment origin", () => {
  expect(
    parseWorkspaceE2EBaseUrl(
      "https://deskohub-workspace-site-a1b2c3d4e-deskohub-bar.vercel.app/"
    )
  ).toEqual({
    baseUrl:
      "https://deskohub-workspace-site-a1b2c3d4e-deskohub-bar.vercel.app",
    expectedHost: "deskohub-workspace-site-a1b2c3d4e-deskohub-bar.vercel.app",
  });
});

test("rejects missing or unsafe preview targets", () => {
  expect(() => parseWorkspaceE2EBaseUrl(undefined)).toThrow(
    "WORKSPACE_E2E_BASE_URL is required"
  );
  expect(() =>
    parseWorkspaceE2EBaseUrl(
      "http://deskohub-workspace-a1b2c3d4e-deskohub-bar.vercel.app"
    )
  ).toThrow("must use HTTPS");
  expect(() =>
    parseWorkspaceE2EBaseUrl("https://workspace.example.com")
  ).toThrow("must use a Vercel deployment host");
  expect(() =>
    parseWorkspaceE2EBaseUrl(
      "https://deskohub-workspace-git-feature-deskohub-bar.vercel.app"
    )
  ).toThrow("not a branch alias");
  expect(() =>
    parseWorkspaceE2EBaseUrl("https://deskohub-workspace.vercel.app")
  ).toThrow("must be an immutable Vercel deployment URL");
  expect(() =>
    parseWorkspaceE2EBaseUrl(
      "https://deskohub-workspace-preview-deskohub-bar.vercel.app"
    )
  ).toThrow("must be an immutable Vercel deployment URL");
  expect(() =>
    parseWorkspaceE2EBaseUrl(
      "https://deskohub-workspace-a1b2c3d4e-deskohub-bar.vercel.app/path"
    )
  ).toThrow("must be an origin");
});

test("rejects a datasource outside the explicit preview allowlist", () => {
  const allowlist =
    "postgresql://synthetic-owner:synthetic-password@ep-preview.eu.neon.tech/neondb";
  expect(() =>
    assertSafeDatabaseUrl(
      "postgresql://synthetic-owner:synthetic-password@ep-preview-pooler.eu.neon.tech/neondb",
      "DATABASE_URL",
      allowlist
    )
  ).not.toThrow();
  expect(() =>
    assertSafeDatabaseUrl(
      "postgresql://synthetic-owner:synthetic-password@ep-other-pooler.eu.neon.tech/neondb",
      "DATABASE_URL",
      allowlist
    )
  ).toThrow("is not allowlisted for workspace e2e");
});
