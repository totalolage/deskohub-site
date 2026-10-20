import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { commandOutput } from "@/scripts/shared/command";
import {
  allocateLoopbackPort,
  waitForOwnedLoopbackServer,
  waitForOwnedLoopbackServerToStop,
} from "./loopback-server";

const appRoot = resolve(import.meta.dir, "../..");
const fixtureBuildTimeoutMs = 120_000;
const fixtureStartupTimeoutMs = 45_000;
const fixtureShutdownTimeoutMs = 5_000;

type NextAppFixtureOptions = {
  /**
   * How long the `production` build may run before it and its descendants are
   * killed. Defaults to two minutes.
   */
  readonly buildTimeoutMs?: number;
  /**
   * Fixture files by path relative to the fixture root, such as
   * `next.config.mjs` and `app/**` routes. A `GET /fixture-ready` route is
   * added for readiness.
   */
  readonly files: Readonly<Record<string, string>>;
  /**
   * `development` serves the app with `next dev`; `production` builds it and
   * serves it with `next start`, for behavior that differs between the two,
   * such as cache lifetimes. Defaults to `development`.
   */
  readonly mode?: "development" | "production";
  /** Prefix for the temporary fixture directory. */
  readonly name: string;
  /** TypeScript path aliases checked before `@/*`, which maps to Workspace sources. */
  readonly paths?: Readonly<Record<string, readonly string[]>>;
};

type NextAppFixture = {
  /** The exit code of the Next server process, once it has exited. */
  readonly exitCode: () => number | undefined;
  readonly url: string;
};

const fixtureTsconfig = (
  paths: Readonly<Record<string, readonly string[]>> = {}
) =>
  JSON.stringify(
    {
      compilerOptions: {
        allowJs: true,
        baseUrl: ".",
        esModuleInterop: true,
        isolatedModules: true,
        jsx: "preserve",
        lib: ["dom", "dom.iterable", "esnext"],
        module: "esnext",
        moduleResolution: "bundler",
        noEmit: true,
        paths: { ...paths, "@/*": ["./source/*"] },
        plugins: [{ name: "next" }],
        skipLibCheck: true,
        strict: true,
        target: "ES2022",
      },
      include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
      exclude: ["node_modules"],
    },
    null,
    2
  );

const readinessRoute = (readinessMarker: string) => `
const readinessMarker = ${JSON.stringify(readinessMarker)};

export async function GET() {
  return new Response(readinessMarker, {
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}
`;

const writeFixture = async (
  fixtureRoot: string,
  readinessMarker: string,
  { files, paths }: NextAppFixtureOptions
) => {
  const allFiles = {
    "app/fixture-ready/route.ts": readinessRoute(readinessMarker),
    "package.json": JSON.stringify(
      { private: true, type: "module", scripts: { dev: "next dev" } },
      null,
      2
    ),
    "tsconfig.json": fixtureTsconfig(paths),
    ...files,
  };
  for (const [relativePath, contents] of Object.entries(allFiles)) {
    const filePath = join(fixtureRoot, relativePath);
    await mkdir(resolve(filePath, ".."), { recursive: true });
    await writeFile(filePath, contents);
  }

  await mkdir(join(fixtureRoot, "source"), { recursive: true });
  for (const directory of ["features", "shared"]) {
    await symlink(
      resolve(appRoot, directory),
      join(fixtureRoot, "source", directory),
      "dir"
    );
  }
  await symlink(
    resolve(appRoot, "node_modules"),
    join(fixtureRoot, "node_modules"),
    "dir"
  );
};

const waitForOwnedChildExit = async (
  childExit: Promise<unknown>,
  timeoutMs: number
): Promise<boolean> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const didExit = await Promise.race([
    childExit.then(() => true),
    new Promise<boolean>((resolveExit) => {
      timer = setTimeout(() => resolveExit(false), timeoutMs);
    }),
  ]);
  if (timer) clearTimeout(timer);
  return didExit;
};

const childEnv = () => ({
  HOME: process.env.HOME ?? "/tmp",
  BUN_OPTIONS: "--no-env-file",
  NEXT_TELEMETRY_DISABLED: "1",
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  TMPDIR: process.env.TMPDIR ?? tmpdir(),
});

const buildFixture = (
  fixtureRoot: string,
  nextCli: string,
  timeoutMs: number
) =>
  commandOutput([process.execPath, nextCli, "build", "--webpack"], {
    cwd: fixtureRoot,
    env: childEnv(),
    timeoutMs,
  });

/**
 * Runs `run` against a throwaway Next app built from `files`, whose
 * `@/*` imports resolve to the real Workspace `features` and `shared`
 * sources. The server and its directory are removed afterwards; a teardown
 * failure fails the caller only when `run` succeeded.
 */
export const withNextAppFixture = async <A>(
  options: NextAppFixtureOptions,
  run: (fixture: NextAppFixture) => Promise<A>
): Promise<A> => {
  const port = await allocateLoopbackPort();
  const readinessMarker = randomUUID();
  const fixtureRoot = await mkdtemp(join(tmpdir(), `${options.name}-`));
  const fixtureUrl = `http://127.0.0.1:${port}`;
  const readinessUrl = `${fixtureUrl}/fixture-ready`;
  let server: ReturnType<typeof Bun.spawn> | undefined;
  let serverExit: Promise<number> | undefined;
  let serverExitCode: number | undefined;
  let teardownError: Error | undefined;
  let result: A;

  try {
    await writeFixture(fixtureRoot, readinessMarker, options);
    const nextCli = resolve(appRoot, "node_modules/next/dist/bin/next");
    const production = options.mode === "production";
    if (production)
      await buildFixture(
        fixtureRoot,
        nextCli,
        options.buildTimeoutMs ?? fixtureBuildTimeoutMs
      );
    server = Bun.spawn(
      [
        process.execPath,
        nextCli,
        ...(production ? ["start"] : ["dev", "--webpack"]),
        "--hostname",
        "127.0.0.1",
        "--port",
        String(port),
      ],
      {
        cwd: fixtureRoot,
        env: childEnv(),
        stderr: "ignore",
        stdin: "ignore",
        stdout: "ignore",
      }
    );
    serverExit = server.exited.then((code) => {
      serverExitCode = code;
      return code;
    });

    await waitForOwnedLoopbackServer({
      exitCode: () => serverExitCode,
      marker: readinessMarker,
      readyUrl: readinessUrl,
      timeoutMs: fixtureStartupTimeoutMs,
    });

    result = await run({ exitCode: () => serverExitCode, url: fixtureUrl });
  } finally {
    try {
      if (server && serverExit) {
        if (serverExitCode === undefined) server.kill("SIGTERM");
        let exited = await waitForOwnedChildExit(
          serverExit,
          fixtureShutdownTimeoutMs
        );
        if (!exited) {
          server.kill("SIGKILL");
          exited = await waitForOwnedChildExit(
            serverExit,
            fixtureShutdownTimeoutMs
          );
        }
        if (!exited)
          teardownError ??= new Error(
            "owned Next fixture child did not exit after SIGKILL"
          );
      }
    } catch {
      teardownError ??= new Error("owned Next fixture child did not stop");
    }
    try {
      await waitForOwnedLoopbackServerToStop({
        marker: readinessMarker,
        readyUrl: readinessUrl,
        timeoutMs: fixtureShutdownTimeoutMs,
      });
    } catch {
      teardownError ??= new Error(
        "owned Next fixture marker did not disappear"
      );
    }
    try {
      await rm(fixtureRoot, { force: true, recursive: true });
    } catch {
      teardownError ??= new Error(
        "owned Next fixture directory was not removed"
      );
    }
  }
  if (teardownError) throw teardownError;
  return result;
};
