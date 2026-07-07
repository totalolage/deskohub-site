import { resolve } from "node:path";
import { Context, Effect, Layer } from "effect";
import {
  assertNexiSandbox as assertNexiSandboxConfig,
  type DatasourceConfig,
  getCheckoutTimeoutMs,
  getConfig,
  getDatasourceConfig,
  getDatasourceTimeoutMs,
  getVercelDeployEnvArgs,
  getVercelDeployTimeoutMs,
  type WorkspaceE2EConfig,
} from "../config";
import {
  addRedaction,
  assertSafeDatabaseUrl,
  loadEnvFile,
  log,
  makeRunner,
  type Runner,
  redact,
  repoRoot,
  scriptDir,
  workspaceDir,
} from "../runtime";

export const effectifyPromise = <A>(try_: () => Promise<A>) =>
  Effect.tryPromise({ try: try_, catch: (cause) => cause });

export const effectifySync = <A>(try_: () => A) =>
  Effect.try({ try: try_, catch: (cause) => cause });

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

interface IWorkspaceE2EEnvFileService {
  readonly load: (path: string) => Effect.Effect<Map<string, string>, unknown>;
  readonly loadLocalEnv: Effect.Effect<Map<string, string>, unknown>;
  readonly loadPreviewEnv: Effect.Effect<Map<string, string>, unknown>;
}

export class WorkspaceE2EEnvFileService extends Context.Service<
  WorkspaceE2EEnvFileService,
  IWorkspaceE2EEnvFileService
>()("WorkspaceE2EEnvFileService") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const paths = yield* WorkspaceE2EPathService;
      const load = (path: string) => effectifyPromise(() => loadEnvFile(path));

      return {
        load,
        loadLocalEnv: load(resolve(paths.workspaceDir, ".env.local")),
        loadPreviewEnv: load(
          resolve(paths.repoRoot, ".vercel/.env.preview.local")
        ),
      };
    })
  );
}

interface IWorkspaceE2EConfigService {
  readonly assertDatasourceSafety: (
    config: DatasourceConfig
  ) => Effect.Effect<void, unknown>;
  readonly assertNexiSandbox: (origin: string) => Effect.Effect<void, unknown>;
  readonly getCheckoutTimeoutMs: () => number;
  readonly getConfig: Effect.Effect<WorkspaceE2EConfig, unknown>;
  readonly getDatasourceConfig: Effect.Effect<DatasourceConfig, unknown>;
  readonly getDatasourceTimeoutMs: () => number;
  readonly getVercelDeployEnvArgs: (
    config: WorkspaceE2EConfig,
    datasourceConfig: DatasourceConfig
  ) => string[];
  readonly getVercelDeployTimeoutMs: () => number;
}

export class WorkspaceE2EConfigService extends Context.Service<
  WorkspaceE2EConfigService,
  IWorkspaceE2EConfigService
>()("WorkspaceE2EConfigService") {
  static Live = Layer.succeed(this, {
    assertDatasourceSafety: (config) =>
      effectifySync(() => {
        assertSafeDatabaseUrl(config.databaseUrl, "DATABASE_URL");
        assertSafeDatabaseUrl(
          config.databaseUrlUnpooled,
          "DATABASE_URL_UNPOOLED"
        );
      }),
    assertNexiSandbox: (origin) =>
      effectifySync(() => assertNexiSandboxConfig(origin)),
    getCheckoutTimeoutMs,
    getConfig: effectifySync(getConfig),
    getDatasourceConfig: effectifySync(getDatasourceConfig),
    getDatasourceTimeoutMs,
    getVercelDeployEnvArgs,
    getVercelDeployTimeoutMs,
  });
}

interface IWorkspaceE2ECommandRunnerService {
  readonly getRunner: Effect.Effect<Runner, unknown>;
  readonly run: (
    command: string,
    args: string[],
    options?: RunCommandOptions
  ) => Effect.Effect<CommandResult, unknown>;
}

export class WorkspaceE2ECommandRunnerService extends Context.Service<
  WorkspaceE2ECommandRunnerService,
  IWorkspaceE2ECommandRunnerService
>()("WorkspaceE2ECommandRunnerService") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const configService = yield* WorkspaceE2EConfigService;
      const getRunner = configService.getConfig.pipe(Effect.map(makeRunner));

      return {
        getRunner,
        run: (command, args, options) =>
          Effect.gen(function* () {
            const runner = yield* getRunner;
            return yield* effectifyPromise(() =>
              runner(command, args, options)
            );
          }),
      };
    })
  );
}
