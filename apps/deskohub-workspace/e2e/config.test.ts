import { expect, test } from "bun:test";
import { getDatasourceConfig, parseWorkspaceE2EBaseUrl } from "./config";
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
  withEnv(
    {
      DATABASE_URL:
        "postgresql://preview.example.test/workspace?sslmode=require",
      WORKSPACE_E2E_DATABASE_URL_UNPOOLED: undefined,
    },
    () =>
      expect(() => getDatasourceConfig()).toThrow(
        "WORKSPACE_E2E_DATABASE_URL_UNPOOLED is required"
      )
  );
});

test("keeps canonical local currency despite sandbox and runner overrides", () => {
  withEnv(
    {
      DATABASE_URL:
        "postgresql://preview-pooler.example.test/workspace",
      DOTYPOS_API_URL: "https://dotypos.example.test",
      DOTYPOS_BRANCH_ID: "branch",
      DOTYPOS_CLIENT_ID: "client",
      DOTYPOS_CLIENT_SECRET: "client-secret",
      DOTYPOS_CLOUD_ID: "cloud",
      DOTYPOS_EMPLOYEE_ID: "employee",
      DOTYPOS_REFRESH_TOKEN: "refresh-token",
      NEXI_API_ORIGIN:
        "https://xpaysandbox.nexigroup.com/api/phoenix-0.0/psp",
      NEXI_CHECKOUT_CURRENCY_OVERRIDE: "EUR",
      WORKSPACE_E2E_DATABASE_URL_UNPOOLED:
        "postgresql://preview.example.test/workspace",
      WORKSPACE_E2E_EXPECTED_CURRENCY: "EUR",
    },
    () => expect(getDatasourceConfig().expectedCurrency).toBe("CZK")
  );
});

test("rejects a datasource outside the explicit preview allowlist", () => {
  withEnv(
    {
      WORKSPACE_E2E_DATABASE_ALLOWLIST:
        "postgresql://owner:test@ep-preview.eu.neon.tech/neondb",
    },
    () => {
      expect(() =>
        assertSafeDatabaseUrl(
          "postgresql://owner:test@ep-preview-pooler.eu.neon.tech/neondb",
          "DATABASE_URL"
        )
      ).not.toThrow();
      expect(() =>
        assertSafeDatabaseUrl(
          "postgresql://owner:test@ep-other-pooler.eu.neon.tech/neondb",
          "DATABASE_URL"
        )
      ).toThrow("is not allowlisted for workspace e2e");
    }
  );
});

const withEnv = (
  values: Readonly<Record<string, string | undefined>>,
  use: () => void
) => {
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]])
  );
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    use();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};
