import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BunServices } from "@effect/platform-bun";
import { Crypto, Effect, FileSystem, Path } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import type { BuildTarget } from "../build-info";
import { installExecutable } from "./executable-installer.service";
import type { AvailableUpdate } from "./update-state-store.service";

const currentExecutable = "#!/bin/sh\necho current\n";

/** A release candidate that prints the build information `dhw version --json` would. */
const candidateScript = ({
  version = "1.1.0",
  target = "linux-x64-baseline",
  exitCode = 0,
  output = JSON.stringify({ version, target }),
}: {
  readonly version?: string;
  readonly target?: string;
  readonly exitCode?: number;
  readonly output?: string;
} = {}) => `#!/bin/sh\nprintf '%s\\n' '${output}'\nexit ${exitCode}\n`;

const updateFor = (
  candidate: string,
  overrides: Partial<AvailableUpdate> = {}
): AvailableUpdate => ({
  version: "1.1.0",
  releaseUrl:
    "https://github.com/totalolage/deskohub-site/releases/tag/dhw-v1.1.0",
  assetUrl:
    "https://github.com/totalolage/deskohub-site/releases/download/dhw-v1.1.0/dhw-linux-x64-baseline",
  assetDigest: `sha256:${createHash("sha256").update(candidate).digest("hex")}`,
  assetSize: Buffer.byteLength(candidate),
  target: "linux-x64-baseline",
  ...overrides,
});

let directory: string;
let executablePath: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "dhw-installer-test-"));
  executablePath = join(directory, "dhw");
  writeFileSync(executablePath, currentExecutable);
  chmodSync(executablePath, 0o755);
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

/** Installs `candidate` as served by a fake release download. */
const install = ({
  candidate,
  update = updateFor(candidate),
  status = 200,
  path = executablePath,
  runningTarget = "linux-x64-baseline",
}: {
  readonly candidate: string;
  readonly update?: AvailableUpdate;
  readonly status?: number;
  readonly path?: string;
  readonly runningTarget?: BuildTarget;
}) => {
  const requestedUrls: string[] = [];
  const httpClient = HttpClient.make((request) =>
    Effect.sync(() => {
      requestedUrls.push(request.url);
      return HttpClientResponse.fromWeb(
        request,
        new Response(candidate, { status })
      );
    })
  );
  const run = Effect.gen(function* () {
    return yield* installExecutable({
      update,
      executable: { path, target: runningTarget },
      crypto: yield* Crypto.Crypto,
      fileSystem: yield* FileSystem.FileSystem,
      httpClient,
      path: yield* Path.Path,
    });
  }).pipe(Effect.scoped, Effect.provide(BunServices.layer));
  return { requestedUrls, run };
};

const leftoverCandidates = () =>
  readdirSync(directory).filter((name) => name.startsWith(".dhw-update-"));

const expectCurrentExecutableKept = () => {
  expect(readFileSync(executablePath, "utf8")).toBe(currentExecutable);
  expect(leftoverCandidates()).toEqual([]);
};

describe("installExecutable", () => {
  test("replaces the executable with a verified release download", async () => {
    const candidate = candidateScript();
    const { requestedUrls, run } = install({ candidate });

    await Effect.runPromise(run);

    expect(requestedUrls).toEqual([updateFor(candidate).assetUrl]);
    expect(readFileSync(executablePath, "utf8")).toBe(candidate);
    expect(statSync(executablePath).mode & 0o777).toBe(0o755);
    expect(leftoverCandidates()).toEqual([]);
  });

  test("refuses to replace anything but a regular file", async () => {
    const executableDirectory = join(directory, "dhw-directory");
    mkdirSync(executableDirectory);
    const { requestedUrls, run } = install({
      candidate: candidateScript(),
      path: executableDirectory,
    });

    const error = await Effect.runPromise(Effect.flip(run));

    expect(error).toMatchObject({
      _tag: "ExecutableInstallerError",
      cause: "Directory",
    });
    expect(requestedUrls).toEqual([]);
  });

  test("fails on an unsuccessful download", async () => {
    const { run } = install({ candidate: candidateScript(), status: 404 });

    const error = await Effect.runPromise(Effect.flip(run));

    expect(error._tag).toBe("HttpClientError");
    expectCurrentExecutableKept();
  });

  test.each([
    ["size-mismatch", { assetSize: 1 }],
    ["digest-mismatch", { assetDigest: `sha256:${"0".repeat(64)}` }],
  ] as const)("rejects a download with a %s", async (cause, overrides) => {
    const candidate = candidateScript();
    const { run } = install({
      candidate,
      update: updateFor(candidate, overrides),
    });

    const error = await Effect.runPromise(Effect.flip(run));

    expect(error).toMatchObject({ _tag: "ExecutableInstallerError", cause });
    expectCurrentExecutableKept();
  });

  test.each([
    [
      "exits unsuccessfully",
      { exitCode: 3 },
      "linux-x64-baseline",
      {
        exitCode: 3,
        buildInfo: { version: "1.1.0", target: "linux-x64-baseline" },
      },
    ],
    [
      "reports another version",
      { version: "1.0.9" },
      "linux-x64-baseline",
      {
        exitCode: 0,
        buildInfo: { version: "1.0.9", target: "linux-x64-baseline" },
      },
    ],
    [
      "reports another target than the release asset",
      { target: "darwin-arm64" },
      "darwin-arm64",
      { exitCode: 0, buildInfo: { version: "1.1.0", target: "darwin-arm64" } },
    ],
    [
      "reports another target than the running executable",
      {},
      "darwin-arm64",
      {
        exitCode: 0,
        buildInfo: { version: "1.1.0", target: "linux-x64-baseline" },
      },
    ],
  ] as const)(
    "rejects a candidate that %s",
    async (_label, script, runningTarget, cause) => {
      const { run } = install({
        candidate: candidateScript(script),
        runningTarget,
      });

      const error = await Effect.runPromise(Effect.flip(run));

      expect(error).toMatchObject({ _tag: "ExecutableInstallerError", cause });
      expectCurrentExecutableKept();
    }
  );

  test("rejects a candidate whose build information is not JSON", async () => {
    const { run } = install({
      candidate: candidateScript({ output: "dhw 1.1.0" }),
    });

    const error = await Effect.runPromise(Effect.flip(run));

    expect(error._tag).toBe("SchemaError");
    expectCurrentExecutableKept();
  });
});
