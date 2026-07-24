import { makeE2EEnvironment } from "./e2e-env";

export const validE2ERuntimeEnvironment = {
  DATABASE_URL:
    "postgresql://owner:test@ep-preview-pooler.eu.neon.tech/neondb",
  DOTYPOS_API_URL: "https://dotypos.example.test",
  DOTYPOS_BRANCH_ID: "branch",
  DOTYPOS_CLIENT_ID: "client",
  DOTYPOS_CLIENT_SECRET: "client-secret",
  DOTYPOS_CLOUD_ID: "cloud",
  DOTYPOS_EMPLOYEE_ID: "employee",
  DOTYPOS_REFRESH_TOKEN: "refresh-token",
  NEXI_API_ORIGIN: "https://xpaysandbox.nexigroup.com/api/phoenix-0.0/psp",
  WORKSPACE_E2E_BASE_URL:
    "https://deskohub-workspace-abc123xyz-deskohub.vercel.app",
  WORKSPACE_E2E_DATABASE_ALLOWLIST:
    "ep-preview.eu.neon.tech/neondb",
  WORKSPACE_E2E_DATABASE_URL_UNPOOLED:
    "postgresql://owner:test@ep-preview.eu.neon.tech/neondb",
} satisfies Readonly<Record<string, string | undefined>>;

export const makeTestE2EEnvironment = (
  overrides: Readonly<Record<string, string | undefined>> = {}
) =>
  makeE2EEnvironment({
    ...validE2ERuntimeEnvironment,
    ...overrides,
  });
