import { addRedaction, assert, env, parseUrl, requireEnv } from "./runtime";

const WORKSPACE_PROJECT_ID = "prj_7FliQBcbBiBwGaO2JLrigicnXCRd";
const WORKSPACE_TEAM_ID = "team_MgMQ4MEWijWnYa1R48C2JU5e";
const DEFAULT_ALIAS = "new.workspace.deskohub.cz";

export const getConfig = () => {
  const vercelToken = requireEnv("VERCEL_TOKEN");
  const vercelTeamId =
    env("VERCEL_TEAM_ID") ?? env("VERCEL_ORG_ID") ?? WORKSPACE_TEAM_ID;
  const vercelProjectId = env("VERCEL_PROJECT_ID") ?? WORKSPACE_PROJECT_ID;
  const alias = env("WORKSPACE_E2E_ALIAS") ?? DEFAULT_ALIAS;
  const bypassSecret = env("VERCEL_AUTOMATION_BYPASS_SECRET");

  addRedaction(vercelToken);
  addRedaction(bypassSecret);

  return {
    alias,
    aliasUrl: `https://${alias}`,
    browserUrl: `https://${alias}`,
    bypassSecret,
    vercelProjectId,
    vercelTeamId,
    vercelToken,
  };
};

export const getDatasourceConfig = () => {
  const databaseUrl = requireEnv("DATABASE_URL");
  const databaseUrlUnpooled =
    env("WORKSPACE_E2E_DATABASE_URL_UNPOOLED") ?? databaseUrl;
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
    expectedCurrency: env("WORKSPACE_E2E_EXPECTED_CURRENCY") ?? "EUR",
    nexiApiOrigin: requireEnv("NEXI_API_ORIGIN"),
  };
};

export const getCheckoutTimeoutMs = () =>
  readCappedTimeoutMs("WORKSPACE_E2E_CHECKOUT_TIMEOUT_MS", 10 * 60 * 1000);

export const getDatasourceTimeoutMs = () =>
  readCappedTimeoutMs("WORKSPACE_E2E_DATASOURCE_TIMEOUT_MS", 4 * 60 * 1000);

export const getVercelDeployTimeoutMs = () =>
  readCappedTimeoutMs("WORKSPACE_E2E_DEPLOY_TIMEOUT_MS", 30 * 60 * 1000);

const readCappedTimeoutMs = (name: string, fallbackMs: number) => {
  const raw = env(name);
  const value = raw ? Number(raw) : fallbackMs;
  if (!Number.isFinite(value) || value <= 0) return fallbackMs;
  return Math.min(value, fallbackMs);
};

export const assertNexiSandbox = (origin: string) =>
  assert(
    parseUrl(origin)?.hostname === "xpaysandbox.nexigroup.com",
    "NEXI_API_ORIGIN must point at Nexi sandbox for workspace checkout e2e"
  );

export const getVercelDeployEnvArgs = (
  config: ReturnType<typeof getConfig>,
  datasourceConfig: ReturnType<typeof getDatasourceConfig>
) => {
  const values = {
    DATABASE_URL: datasourceConfig.databaseUrl,
    DATABASE_URL_UNPOOLED: datasourceConfig.databaseUrlUnpooled,
    DOTYPOS_API_TIMEOUT: String(datasourceConfig.dotypos.apiTimeout),
    DOTYPOS_API_URL: datasourceConfig.dotypos.apiUrl,
    DOTYPOS_BRANCH_ID: datasourceConfig.dotypos.branchId,
    DOTYPOS_CLIENT_ID: datasourceConfig.dotypos.clientId,
    DOTYPOS_CLIENT_SECRET: datasourceConfig.dotypos.clientSecret,
    DOTYPOS_CLOUD_ID: datasourceConfig.dotypos.cloudId,
    DOTYPOS_EMPLOYEE_ID: datasourceConfig.dotypos.employeeId,
    DOTYPOS_REFRESH_TOKEN: datasourceConfig.dotypos.refreshToken,
    EMAIL_PROVIDER: "console",
    NEXI_API_ORIGIN: datasourceConfig.nexiApiOrigin,
    NEXI_CHECKOUT_CURRENCY_OVERRIDE: datasourceConfig.expectedCurrency,
    WORKSPACE_CALLBACK_ORIGIN: config.aliasUrl,
    ...(config.bypassSecret
      ? { VERCEL_AUTOMATION_BYPASS_SECRET: config.bypassSecret }
      : {}),
  };

  const buildValues = Object.fromEntries(
    Object.entries(values).filter(
      ([key]) => key !== "VERCEL_AUTOMATION_BYPASS_SECRET"
    )
  );

  return [
    ...Object.entries(buildValues).flatMap(([key, value]) => [
      "--build-env",
      `${key}=${value}`,
    ]),
    ...Object.entries(values).flatMap(([key, value]) => [
      "--env",
      `${key}=${value}`,
    ]),
  ];
};

export type WorkspaceE2EConfig = ReturnType<typeof getConfig>;
export type DatasourceConfig = ReturnType<typeof getDatasourceConfig>;
