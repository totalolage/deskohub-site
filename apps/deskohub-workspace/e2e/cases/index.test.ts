import { expect, test } from "bun:test";
import type { DatasourceConfig, WorkspaceE2EConfig } from "../config";
import type { Runner } from "../runtime";
import { defaultWorkspaceE2ETimeouts } from "../timeouts";
import type { makeWorkspaceE2ECases } from ".";

test("case construction requires no deployment identity", () => {
  const input: Parameters<typeof makeWorkspaceE2ECases>[0] = {
    config: makeConfig(),
    datasourceConfig: makeDatasourceConfig(),
    flowStates: [],
    run: makeRunner(),
  };

  expect(input).not.toHaveProperty("deploymentId");
});

const makeConfig = (): WorkspaceE2EConfig => ({
  baseUrl: "https://deskohub-workspace-a1b2c3d4e-deskohub-bar.vercel.app",
  bypassSecret: "test-protection-bypass",
  expectedHost: "deskohub-workspace-a1b2c3d4e-deskohub-bar.vercel.app",
  timeouts: defaultWorkspaceE2ETimeouts,
});

const makeDatasourceConfig = (): DatasourceConfig => ({
  databaseUrl: "postgresql://preview.example.test/workspace",
  databaseUrlUnpooled: "postgresql://preview-direct.example.test/workspace",
  dotypos: {
    apiTimeout: 5_000,
    apiUrl: "https://dotypos.example.test",
    branchId: "branch",
    clientId: "client",
    clientSecret: "client-secret",
    cloudId: "cloud",
    employeeId: "employee",
    refreshToken: "refresh-token",
  },
  expectedCurrency: "EUR",
  nexiApiOrigin: "https://xpaysandbox.nexigroup.com/api/phoenix-0.0/psp",
  timeouts: defaultWorkspaceE2ETimeouts,
});

const makeRunner = (): Runner => async () => ({
  exitCode: 0,
  stderr: "",
  stdout: "",
});
