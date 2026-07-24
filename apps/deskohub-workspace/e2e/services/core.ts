import { Context, Effect, Layer } from "effect";
import {
  assertNexiSandbox as assertNexiSandboxConfig,
  type DatasourceConfig,
  getConfig,
  getDatasourceConfig,
  type WorkspaceE2EConfig,
} from "../config";
import type { E2EEnvironment } from "../e2e-env";
import {
  tryWorkspaceE2EPromise,
  tryWorkspaceE2ESync,
  type WorkspaceE2EError,
} from "../errors";
import {
  addRedaction,
  assertSafeDatabaseUrl,
  log,
  makeRunner,
  type Runner,
  redact,
  repoRoot,
  scriptDir,
  workspaceDir,
} from "../runtime";

export type CommandResult = Awaited<ReturnType<Runner>>;
export type RunCommandOptions = Parameters<Runner>[2];

interface IWorkspaceE2EPathService {
  readonly repoRoot: string;
  readonly scriptDir: string;
  readonly workspaceDir: string;
}

export class WorkspaceE2EPathService extends Context.Service<
  WorkspaceE2EPathService,
  IWorkspaceE2EPathService
>()("WorkspaceE2EPathService") {
  static Live = Layer.succeed(this, { repoRoot, scriptDir, workspaceDir });
}

interface IWorkspaceE2ERedactionService {
  readonly add: (value: string | undefined, force?: boolean) => void;
  readonly log: (message: string) => void;
  readonly redact: (text: string) => string;
}

export class WorkspaceE2ERedactionService extends Context.Service<
  WorkspaceE2ERedactionService,
  IWorkspaceE2ERedactionService
>()("WorkspaceE2ERedactionService") {
  static Live = Layer.succeed(this, {
    add: addRedaction,
    log,
    redact,
  });
}

interface IWorkspaceE2EConfigService {
  readonly assertDatasourceSafety: (
    config: DatasourceConfig
  ) => Effect.Effect<void, WorkspaceE2EError>;
  readonly assertNexiSandbox: (
    origin: string
  ) => Effect.Effect<void, WorkspaceE2EError>;
  readonly getConfig: Effect.Effect<WorkspaceE2EConfig, WorkspaceE2EError>;
  readonly getDatasourceConfig: Effect.Effect<
    DatasourceConfig,
    WorkspaceE2EError
  >;
}

export class WorkspaceE2EConfigService extends Context.Service<
  WorkspaceE2EConfigService,
  IWorkspaceE2EConfigService
>()("WorkspaceE2EConfigService") {
  static layer = (environment: E2EEnvironment) =>
    Layer.succeed(this, {
      assertDatasourceSafety: (config) =>
        tryWorkspaceE2ESync("assert datasource safety", () => {
          assertSafeDatabaseUrl(
            config.databaseUrl,
            "DATABASE_URL",
            environment.WORKSPACE_E2E_DATABASE_ALLOWLIST
          );
          assertSafeDatabaseUrl(
            config.databaseUrlUnpooled,
            "WORKSPACE_E2E_DATABASE_URL_UNPOOLED",
            environment.WORKSPACE_E2E_DATABASE_ALLOWLIST
          );
        }),
      assertNexiSandbox: (origin) =>
        tryWorkspaceE2ESync("assert Nexi sandbox configuration", () =>
          assertNexiSandboxConfig(origin)
        ),
      getConfig: tryWorkspaceE2ESync("read workspace e2e config", () =>
        getConfig(environment)
      ),
      getDatasourceConfig: tryWorkspaceE2ESync(
        "read workspace e2e datasource config",
        () => getDatasourceConfig(environment)
      ),
    });
}

interface IWorkspaceE2ECommandRunnerService {
  readonly getRunner: Effect.Effect<Runner, WorkspaceE2EError>;
  readonly run: (
    command: string,
    args: string[],
    options?: RunCommandOptions
  ) => Effect.Effect<CommandResult, WorkspaceE2EError>;
}

export class WorkspaceE2ECommandRunnerService extends Context.Service<
  WorkspaceE2ECommandRunnerService,
  IWorkspaceE2ECommandRunnerService
>()("WorkspaceE2ECommandRunnerService") {
  static layer = (environment: E2EEnvironment) =>
    Layer.succeed(this, makeCommandRunnerService(environment));
}

function makeCommandRunnerService(
  environment: E2EEnvironment
): IWorkspaceE2ECommandRunnerService {
  const runner = makeRunner(environment);
  return {
    getRunner: Effect.succeed(runner),
    run: (command, args, options) =>
      tryWorkspaceE2EPromise(`run command ${command}`, (signal) =>
        runner(command, args, { ...options, signal })
      ),
  };
}
