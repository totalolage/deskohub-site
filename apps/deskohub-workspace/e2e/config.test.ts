import { expect, test } from "bun:test";
import { getDatasourceConfig, parseWorkspaceE2EBaseUrl } from "./config";
import { makeE2EEnvironment } from "./e2e-env";
import {
  makeTestE2EEnvironment,
  validE2ERuntimeEnvironment,
} from "./e2e-env.test-fixture";
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

test("requires a direct datasource URL", () => {
  expect(() =>
    makeE2EEnvironment({
      ...validE2ERuntimeEnvironment,
      WORKSPACE_E2E_DATABASE_URL_UNPOOLED: undefined,
    })
  ).toThrow("Invalid workspace E2E environment variables.");
});

test("keeps canonical local currency in datasource assertions", () => {
  expect(
    getDatasourceConfig(makeTestE2EEnvironment()).expectedCurrency
  ).toBe("CZK");
});

test("rejects a datasource outside the explicit preview allowlist", () => {
  const allowlist =
    "postgresql://owner:test@ep-preview.eu.neon.tech/neondb";
  expect(() =>
    assertSafeDatabaseUrl(
      "postgresql://owner:test@ep-preview-pooler.eu.neon.tech/neondb",
      "DATABASE_URL",
      allowlist
    )
  ).not.toThrow();
  expect(() =>
    assertSafeDatabaseUrl(
      "postgresql://owner:test@ep-other-pooler.eu.neon.tech/neondb",
      "DATABASE_URL",
      allowlist
    )
  ).toThrow("is not allowlisted for workspace e2e");
});

test("decodes timeout overrides once for E2E consumers", () => {
  const config = getDatasourceConfig(
    makeTestE2EEnvironment({
      WORKSPACE_E2E_DATASOURCE_TIMEOUT_MS: "45000",
    })
  );
  expect(config.timeouts.datasource).toBe(45_000);
});
