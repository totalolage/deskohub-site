import { addRedaction, assert, env, parseUrl, requireEnv } from "./runtime";

const immutableWorkspaceDeploymentHost =
  /^deskohub-workspace(?:-site)?-[a-z0-9]{9}-[a-z0-9-]+\.vercel\.app$/;

export const getConfig = () => {
  const target = parseWorkspaceE2EBaseUrl(env("WORKSPACE_E2E_BASE_URL"));
  const bypassSecret = env("VERCEL_AUTOMATION_BYPASS_SECRET");

  addRedaction(bypassSecret);

  return {
    ...target,
    bypassSecret,
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

export const getDatasourceConfig = () => {
  const databaseUrl = requireEnv("DATABASE_URL");
  const databaseUrlUnpooled = requireEnv("WORKSPACE_E2E_DATABASE_URL_UNPOOLED");
  addRedaction(databaseUrlUnpooled);

  return {
    databaseUrl,
    databaseUrlUnpooled,
    dotypos: {
      apiTimeout: Number(env("DOTYPOS_API_TIMEOUT") ?? 5_000),
      apiUrl: requireEnv("DOTYPOS_API_URL"),
      branchId: requireEnv("DOTYPOS_BRANCH_ID"),
      clientId: requireEnv("DOTYPOS_CLIENT_ID"),
      clientSecret: requireEnv("DOTYPOS_CLIENT_SECRET"),
      cloudId: requireEnv("DOTYPOS_CLOUD_ID"),
      employeeId: requireEnv("DOTYPOS_EMPLOYEE_ID"),
      refreshToken: requireEnv("DOTYPOS_REFRESH_TOKEN"),
    },
    expectedCurrency: "CZK",
    nexiApiOrigin: requireEnv("NEXI_API_ORIGIN"),
  };
};

export const assertNexiSandbox = (origin: string) =>
  assert(
    parseUrl(origin)?.hostname === "xpaysandbox.nexigroup.com",
    "NEXI_API_ORIGIN must point at Nexi sandbox for workspace checkout e2e"
  );

export type WorkspaceE2EConfig = ReturnType<typeof getConfig>;
export type DatasourceConfig = ReturnType<typeof getDatasourceConfig>;
