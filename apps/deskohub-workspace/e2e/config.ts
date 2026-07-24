import type { E2EEnvironment } from "./e2e-env";
import { addRedaction, assert, parseUrl } from "./runtime";
import {
  makeWorkspaceE2ETimeouts,
  type WorkspaceE2ETimeouts,
} from "./timeouts";

const immutableWorkspaceDeploymentHost =
  /^deskohub-workspace(?:-site)?-[a-z0-9]{9}-[a-z0-9-]+\.vercel\.app$/;

export const getConfig = (
  environment: E2EEnvironment,
  timeouts: WorkspaceE2ETimeouts = makeWorkspaceE2ETimeouts(environment)
) => {
  const target = parseWorkspaceE2EBaseUrl(environment.WORKSPACE_E2E_BASE_URL);
  const bypassSecret = environment.VERCEL_AUTOMATION_BYPASS_SECRET;

  addRedaction(bypassSecret);

  return {
    ...target,
    bypassSecret,
    timeouts,
  };
};

export const parseWorkspaceE2EBaseUrl = (value: string | undefined) => {
  assert(value, "WORKSPACE_E2E_BASE_URL is required for workspace e2e");
  const url = parseUrl(value);
  assert(url, "WORKSPACE_E2E_BASE_URL must be a valid URL");
  assert(url.protocol === "https:", "WORKSPACE_E2E_BASE_URL must use HTTPS");
  assert(
    url.hostname.endsWith(".vercel.app"),
    "WORKSPACE_E2E_BASE_URL must use a Vercel deployment host"
  );
  assert(
    !url.hostname.includes("-git-"),
    "WORKSPACE_E2E_BASE_URL must be an immutable deployment URL, not a branch alias"
  );
  assert(
    immutableWorkspaceDeploymentHost.test(url.hostname),
    "WORKSPACE_E2E_BASE_URL must be an immutable Vercel deployment URL"
  );
  assert(
    !url.username && !url.password && !url.port,
    "WORKSPACE_E2E_BASE_URL must not contain credentials or a custom port"
  );
  assert(
    url.pathname === "/" && !url.search && !url.hash,
    "WORKSPACE_E2E_BASE_URL must be an origin without a path, query, or hash"
  );

  return {
    baseUrl: url.origin,
    expectedHost: url.host,
  };
};

export const getDatasourceConfig = (
  environment: E2EEnvironment,
  timeouts: WorkspaceE2ETimeouts = makeWorkspaceE2ETimeouts(environment)
) => {
  const databaseUrl = environment.DATABASE_URL;
  const databaseUrlUnpooled =
    environment.WORKSPACE_E2E_DATABASE_URL_UNPOOLED;
  [
    databaseUrl,
    databaseUrlUnpooled,
    environment.DOTYPOS_API_URL,
    environment.DOTYPOS_BRANCH_ID,
    environment.DOTYPOS_CLIENT_ID,
    environment.DOTYPOS_CLIENT_SECRET,
    environment.DOTYPOS_CLOUD_ID,
    environment.DOTYPOS_EMPLOYEE_ID,
    environment.DOTYPOS_REFRESH_TOKEN,
    environment.NEXI_API_ORIGIN,
    environment.WORKSPACE_E2E_DATABASE_ALLOWLIST,
  ].forEach((value) => addRedaction(value));

  return {
    databaseUrl,
    databaseUrlUnpooled,
    dotypos: {
      apiTimeout: environment.DOTYPOS_API_TIMEOUT ?? 5_000,
      apiUrl: environment.DOTYPOS_API_URL,
      branchId: environment.DOTYPOS_BRANCH_ID,
      clientId: environment.DOTYPOS_CLIENT_ID,
      clientSecret: environment.DOTYPOS_CLIENT_SECRET,
      cloudId: environment.DOTYPOS_CLOUD_ID,
      employeeId: environment.DOTYPOS_EMPLOYEE_ID,
      refreshToken: environment.DOTYPOS_REFRESH_TOKEN,
    },
    expectedCurrency: "CZK",
    nexiApiOrigin: environment.NEXI_API_ORIGIN,
    timeouts,
  };
};

export const assertNexiSandbox = (origin: string) =>
  assert(
    parseUrl(origin)?.hostname === "xpaysandbox.nexigroup.com",
    "NEXI_API_ORIGIN must point at Nexi sandbox for workspace checkout e2e"
  );

export type WorkspaceE2EConfig = ReturnType<typeof getConfig>;
export type DatasourceConfig = ReturnType<typeof getDatasourceConfig>;
