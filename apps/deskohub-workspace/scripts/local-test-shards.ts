import { join, resolve } from "node:path";
import { commandOutput, runCommand } from "./shared/command";
import { parseWorkflow, type WorkflowDoc } from "./shared/workflow-contract";
import { testShardCount } from "./test-shard";

/**
 * Runs the Workspace test shards on this machine exactly as Workspace CI
 * runs them: the same cached Turbo tasks, `CI=true` and `TZ=UTC`, and one
 * throwaway Postgres container per shard from the image CI uses. A shard
 * computed here is a cache hit in CI and the other way round, through the
 * Turbo remote cache when this machine is logged in to it.
 *
 * Containers publish Postgres on a dynamic loopback port, so a local
 * Postgres on 5432 is never touched, and they are removed on exit and on
 * SIGINT or SIGTERM. Extra arguments go to `turbo run`, such as `--dry=json`
 * or `--force`.
 */

const repositoryRoot = resolve(import.meta.dir, "../../..");
const workflowPath = join(
  repositoryRoot,
  ".github/workflows/workspace-tests.yml"
);
const shardJob = "test-functional-shards";

/** The fixed Turbo task that runs one shard. */
export const shardTask = (shard: number): string => `test:shard-${shard}`;

export const shardTasks = Array.from({ length: testShardCount }, (_, index) =>
  shardTask(index + 1)
);

export interface ShardDatabase {
  readonly image: string;
  readonly user: string;
  readonly password: string;
  readonly database: string;
}

/** The Postgres service each CI shard job starts. */
export const shardJobDatabase = (workflow: WorkflowDoc): ShardDatabase => {
  const service = workflow.jobs[shardJob]?.services?.postgres;
  const user = service?.env?.POSTGRES_USER;
  const password = service?.env?.POSTGRES_PASSWORD;
  const database = service?.env?.POSTGRES_DB;
  if (!(service?.image && user && password && database)) {
    throw new Error(
      `${shardJob} in ${workflowPath} no longer declares a postgres service with POSTGRES_USER, POSTGRES_PASSWORD, and POSTGRES_DB.`
    );
  }
  return { image: service.image, user, password, database };
};

/** Reads the host port from `docker port <container> 5432/tcp`. */
export const publishedPort = (dockerPortOutput: string): number => {
  const port = Number(
    /^127\.0\.0\.1:(\d+)$/m.exec(dockerPortOutput.trim())?.[1]
  );
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(
      `Expected a 127.0.0.1 port from docker port, got: ${dockerPortOutput}`
    );
  }
  return port;
};

export const databaseUrl = (database: ShardDatabase, port: number): string =>
  `postgresql://${database.user}:${database.password}@127.0.0.1:${port}/${database.database}`;

/**
 * The environment Turbo runs with: only what the cached graph needs, so
 * unhashed pass-through variables from the caller (runtime configuration,
 * `BUN_OPTIONS`) never reach the tasks. `TURBO_*` keeps remote-cache access.
 */
export const turboEnvironment = (
  environment: Readonly<Record<string, string | undefined>>,
  shardUrls: ReadonlyArray<string>
): Record<string, string> => {
  const selected: Record<string, string> = {};
  for (const [name, value] of Object.entries(environment)) {
    if (value === undefined) continue;
    if (
      ["HOME", "PATH", "SHELL", "TERM", "TMPDIR", "USER"].includes(name) ||
      name.startsWith("TURBO_")
    ) {
      selected[name] = value;
    }
  }
  selected.CI = "true";
  selected.TZ = "UTC";
  shardUrls.forEach((url, index) => {
    selected[`WORKSPACE_TEST_DATABASE_URL_SHARD_${index + 1}`] = url;
  });
  return selected;
};

export const turboCommand = (
  extraArguments: ReadonlyArray<string>
): readonly string[] => [
  "bun",
  "--no-env-file",
  "turbo",
  "run",
  ...shardTasks,
  "--filter=./apps/deskohub-workspace",
  "--continue",
  ...extraArguments,
];

const readinessTimeoutMs = 60_000;

/**
 * Marks the containers a runner starts with that runner's process id, so a
 * later run can remove the ones a crashed runner left behind.
 */
const shardContainerLabel = "deskohub.workspace-test-shards";

/**
 * Picks the containers whose runner is gone from `docker ps` lines of
 * `<container id> <owner pid>`.
 */
export const abandonedContainers = (
  dockerPsOutput: string,
  isRunning: (pid: number) => boolean
): readonly string[] =>
  dockerPsOutput
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter(([container, owner]) => {
      const pid = Number(owner);
      return (
        Boolean(container) &&
        !(Number.isInteger(pid) && pid > 0 && isRunning(pid))
      );
    })
    .map(([container]) => container as string);

const isRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const startDatabase = async (database: ShardDatabase): Promise<string> =>
  (
    await commandOutput(
      [
        "docker",
        "run",
        "--detach",
        "--rm",
        "--env",
        `POSTGRES_USER=${database.user}`,
        "--env",
        `POSTGRES_PASSWORD=${database.password}`,
        "--env",
        `POSTGRES_DB=${database.database}`,
        "--label",
        `${shardContainerLabel}=${process.pid}`,
        "--publish",
        "127.0.0.1::5432",
        database.image,
      ],
      { timeoutMs: 300_000 }
    )
  ).trim();

// The image's entrypoint first initializes over the Unix socket only, so a
// TCP check passes once the final server accepts connections.
const waitUntilReady = async (
  container: string,
  database: ShardDatabase
): Promise<void> => {
  const deadline = Date.now() + readinessTimeoutMs;
  for (;;) {
    const probe = await runCommand(
      [
        "docker",
        "exec",
        container,
        "pg_isready",
        "--host=127.0.0.1",
        `--username=${database.user}`,
        `--dbname=${database.database}`,
      ],
      { timeoutMs: 10_000 }
    );
    if (probe.exitCode === 0) return;
    if (Date.now() > deadline) {
      throw new Error(
        `Postgres in container ${container} was not ready within ${readinessTimeoutMs / 1000}s.`
      );
    }
    await Bun.sleep(500);
  }
};

const removeContainers = async (containers: ReadonlyArray<string>) => {
  if (containers.length === 0) return;
  await runCommand(["docker", "rm", "--force", ...containers], {
    timeoutMs: 60_000,
  });
};

const runLocalShards = async (
  extraArguments: ReadonlyArray<string>
): Promise<number> => {
  const database = shardJobDatabase(parseWorkflow(workflowPath));
  await removeContainers(
    abandonedContainers(
      await commandOutput([
        "docker",
        "ps",
        "--all",
        "--filter",
        `label=${shardContainerLabel}`,
        "--format",
        `{{.ID}} {{.Label "${shardContainerLabel}"}}`,
      ]),
      isRunning
    )
  );
  const containers: string[] = [];
  const stopOnSignal = (signal: NodeJS.Signals, code: number) => {
    process.once(signal, () => {
      void removeContainers(containers).finally(() => process.exit(code));
    });
  };
  stopOnSignal("SIGINT", 130);
  stopOnSignal("SIGTERM", 143);
  try {
    const urls: string[] = [];
    for (let shard = 1; shard <= testShardCount; shard++) {
      const container = await startDatabase(database);
      containers.push(container);
      const port = publishedPort(
        await commandOutput(["docker", "port", container, "5432/tcp"])
      );
      urls.push(databaseUrl(database, port));
    }
    await Promise.all(
      containers.map((container) => waitUntilReady(container, database))
    );
    const result = await runCommand(turboCommand(extraArguments), {
      cwd: repositoryRoot,
      env: turboEnvironment(process.env, urls),
      forwardOutput: { stdout: process.stdout, stderr: process.stderr },
    });
    return result.exitCode ?? 1;
  } finally {
    await removeContainers(containers);
  }
};

if (import.meta.main) {
  runLocalShards(process.argv.slice(2))
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : error}\n`
      );
      process.exitCode = 1;
    });
}
