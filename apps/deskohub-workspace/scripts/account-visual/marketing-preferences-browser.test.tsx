import { expect, spyOn, test } from "bun:test";
import {
  access,
  constants,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import {
  clearTimeout as clearNativeTimeout,
  setTimeout as setNativeTimeout,
} from "node:timers";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import {
  compileMarketingPreferencesFixture,
  formatBuildDiagnostics,
  verifyMarketingPreferencesBrowserFixture,
} from "./marketing-preferences-fixture";

const repoRoot = resolve(import.meta.dir, "../../../..");
const appRoot = resolve(import.meta.dir, "../..");
const artifactRoot = join(repoRoot, ".artifacts/marketing-preferences-browser");

const chromiumAvailable = await access(
  chromium.executablePath(),
  constants.X_OK
)
  .then(() => true)
  .catch(() => false);

const fixtureChildScript = (stdout: string, exitCode = 0): string =>
  `process.stdout.write(${JSON.stringify(stdout)}); process.exitCode = ${exitCode};`;

const withMockedFixtureChild = async <T,>(
  script: string,
  check: () => Promise<T>
): Promise<T> => {
  const originalSpawn = Bun.spawn.bind(Bun);
  let child: Bun.Subprocess | undefined;
  const spawn = spyOn(Bun, "spawn").mockImplementation((_command, options) => {
    child = originalSpawn([process.execPath, "-e", script], options);
    return child;
  });

  try {
    return await check();
  } finally {
    spawn.mockRestore();
    await child?.exited.catch(() => undefined);
  }
};

const writeMockFixtureOutputs = async (outputDirectory: string) => {
  await mkdir(outputDirectory, { recursive: true });
  const schedulerPath = createRequire(join(appRoot, "package.json")).resolve(
    "scheduler"
  );
  const schedulerBytes = await readFile(schedulerPath);
  const cssPath = join(outputDirectory, "entry.css");
  const entryPath = join(outputDirectory, "entry.tsx");
  const javascriptPath = join(outputDirectory, "entry.js");
  await writeFile(cssPath, "/* synthetic CSS */\n", "utf8");
  await writeFile(entryPath, "export {};\n", "utf8");
  await writeFile(javascriptPath, "const syntheticBundle = true;\n", "utf8");
  return {
    bunVersion: Bun.version,
    cssPath,
    entryPath,
    javascriptPath,
    scheduler: { bytes: schedulerBytes.byteLength, path: schedulerPath },
    status: "ok" as const,
  };
};

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

test("formats nested build diagnostics without attached payloads", () => {
  const output = formatBuildDiagnostics(
    new AggregateError([
      new AggregateError([
        {
          lineText: "synthetic line text",
          message:
            "Could not resolve the controlled renderer DATABASE_URL=synthetic-environment-value",
          position: {
            column: 4,
            file: "https://synthetic-user:synthetic-password@example.test/entry.tsx?token=synthetic-query-value",
            line: 17,
            lineText: "synthetic position line text",
          },
          token: "synthetic attached token value",
        },
      ]),
    ])
  );

  expect(output).toContain(
    "https://[REDACTED]@example.test/entry.tsx?token=[REDACTED]:17:4: Could not resolve the controlled renderer DATABASE_URL=[REDACTED]"
  );
  expect(output).not.toContain("synthetic line text");
  expect(output).not.toContain("synthetic attached token value");
  expect(output).not.toContain("synthetic-password");
  expect(output).not.toContain("synthetic-query-value");
  expect(output).not.toContain("synthetic-environment-value");
});

test("uses a safe fallback for unknown build diagnostics", () => {
  expect(
    formatBuildDiagnostics({
      toString: () => "synthetic unknown payload",
      unexpected: "synthetic unknown value",
    })
  ).toBe("[unknown build diagnostic]");
  expect(formatBuildDiagnostics("synthetic build failure")).toBe(
    "synthetic build failure"
  );
});

test("redacts build diagnostic environment assignment tails without crossing lines", () => {
  const output = formatBuildDiagnostics([
    {
      message: "DATABASE_URL=synthetic-environment-value, comma suffix",
    },
    {
      message: String.raw`API_KEY=synthetic-api-value, escaped quote \"suffix\"`,
    },
    {
      message:
        "MULTILINE=synthetic-multiline-value, hidden suffix\nnext diagnostic line is retained",
    },
  ]);

  expect(output).toContain(
    "DATABASE_URL=[REDACTED]\nAPI_KEY=[REDACTED]\nMULTILINE=[REDACTED]\nnext diagnostic line is retained"
  );
  expect(output).not.toContain("comma suffix");
  expect(output).not.toContain("escaped quote");
  expect(output).not.toContain("hidden suffix");
  expect(output).not.toContain("synthetic-environment-value");
  expect(output).not.toContain("synthetic-api-value");
  expect(output).not.toContain("synthetic-multiline-value");
});

test("formats native Bun build diagnostics with a source location", async () => {
  const diagnosticNamespace = "marketing-preferences-diagnostic";
  const diagnosticEntry = "virtual-marketing-preferences-diagnostic-entry";
  const missingModule = "./__missing_marketing_preferences_diagnostic__";
  let thrown: unknown;

  try {
    await Bun.build({
      entrypoints: [diagnosticEntry],
      format: "esm",
      plugins: [
        {
          name: "marketing-preferences-diagnostic",
          setup(build) {
            build.onResolve(
              { filter: /^virtual-marketing-preferences-diagnostic-entry$/ },
              () => ({
                namespace: diagnosticNamespace,
                path: diagnosticEntry,
              })
            );
            build.onLoad(
              {
                filter: /^virtual-marketing-preferences-diagnostic-entry$/,
                namespace: diagnosticNamespace,
              },
              () => ({
                contents: `import ${JSON.stringify(missingModule)};`,
                loader: "js",
                resolveDir: import.meta.dir,
              })
            );
          },
        },
      ],
    });
  } catch (cause) {
    thrown = cause;
  }

  expect(thrown).toBeInstanceOf(AggregateError);
  if (!(thrown instanceof AggregateError)) return;

  const output = formatBuildDiagnostics(thrown);
  expect(output).toContain(missingModule);
  expect(output).toMatch(new RegExp(`${diagnosticEntry}:\\d+:\\d+:`));
});

test.serial(
  "rejects an invalid marketing preferences child app root without leaking its path",
  async () => {
    await mkdir(artifactRoot, { recursive: true });
    const directory = await mkdtemp(
      join(artifactRoot, "marketing-preferences-invalid-app-root-")
    );
    const rawSentinel = "synthetic-invalid-app-root-sentinel";
    try {
      let thrown: unknown;
      try {
        await compileMarketingPreferencesFixture({
          appRoot: join(directory, `missing-DATABASE_URL=${rawSentinel}`),
          outputDirectory: join(directory, "output"),
        });
      } catch (cause) {
        thrown = cause;
      }

      expect(errorMessage(thrown)).toBe(
        "Could not launch marketing preferences fixture child"
      );
      expect(errorMessage(thrown)).not.toContain(rawSentinel);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  }
);

test.serial(
  "sanitizes an actual marketing preferences child compiler fault",
  async () => {
    await mkdir(artifactRoot, { recursive: true });
    const directory = await mkdtemp(
      join(artifactRoot, "marketing-preferences-build-failure-")
    );
    const rawSentinel = "synthetic-build-diagnostic";
    const invalidAppRoot = join(directory, `app-DATABASE_URL=${rawSentinel}`);
    try {
      await mkdir(join(invalidAppRoot, "app"), { recursive: true });
      await mkdir(join(invalidAppRoot, "scripts/account-visual"), {
        recursive: true,
      });
      await writeFile(
        join(invalidAppRoot, "package.json"),
        JSON.stringify({
          name: "synthetic-marketing-preferences-app",
          type: "module",
        }),
        "utf8"
      );
      await symlink(
        join(appRoot, "node_modules"),
        join(invalidAppRoot, "node_modules"),
        "dir"
      );
      await writeFile(
        join(invalidAppRoot, "app/globals.css"),
        "body { margin: 0; }\n",
        "utf8"
      );
      await writeFile(
        join(invalidAppRoot, "postcss.config.mjs"),
        "export default { plugins: {} };\n",
        "utf8"
      );
      await writeFile(
        join(
          invalidAppRoot,
          "scripts/account-visual/marketing-preferences-adapter.tsx"
        ),
        `import "DATABASE_URL=${rawSentinel}";\nexport default function InvalidAdapter() { return null; }\n`,
        "utf8"
      );

      let thrown: unknown;
      try {
        await compileMarketingPreferencesFixture({
          appRoot: invalidAppRoot,
          outputDirectory: join(directory, "output"),
        });
      } catch (cause) {
        thrown = cause;
      }

      const message = errorMessage(thrown);
      expect(message).toContain("Marketing preferences fixture child failed");
      expect(message).toContain("DATABASE_URL=[REDACTED]");
      expect(message).not.toContain(rawSentinel);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  }
);

test.serial(
  "kills and awaits a timed-out marketing preferences fixture child",
  async () => {
    await mkdir(artifactRoot, { recursive: true });
    const directory = await mkdtemp(
      join(artifactRoot, "marketing-preferences-timeout-")
    );
    let child: Bun.Subprocess | undefined;
    const originalSpawn = Bun.spawn.bind(Bun);
    const spawn = spyOn(Bun, "spawn").mockImplementation((command, options) => {
      child = originalSpawn(command, options);
      return child;
    });

    try {
      await expect(
        compileMarketingPreferencesFixture({
          appRoot,
          outputDirectory: join(directory, "output"),
          timeoutMs: 1,
        })
      ).rejects.toThrow(
        "Marketing preferences fixture child timed out after 1ms"
      );

      expect(spawn).toHaveBeenCalledTimes(1);
      const launchedChild = child;
      expect(launchedChild).toBeDefined();
      if (launchedChild === undefined) return;
      expect(launchedChild.pid).toBeGreaterThan(0);
      expect(launchedChild.killed).toBe(true);
      expect(await launchedChild.exited).not.toBe(0);
    } finally {
      spawn.mockRestore();
      await child?.exited.catch(() => undefined);
      await rm(directory, { force: true, recursive: true });
    }
  }
);

test.serial(
  "rejects malformed fixture-child stdout without leaking its raw sentinel",
  async () => {
    await mkdir(artifactRoot, { recursive: true });
    const directory = await mkdtemp(
      join(artifactRoot, "marketing-preferences-malformed-stdout-")
    );
    const rawSentinel = "synthetic-malformed-stdout-sentinel";
    try {
      await withMockedFixtureChild(
        fixtureChildScript(rawSentinel),
        async () => {
          let thrown: unknown;
          try {
            await compileMarketingPreferencesFixture({
              appRoot,
              outputDirectory: join(directory, "output"),
            });
          } catch (cause) {
            thrown = cause;
          }

          expect(errorMessage(thrown)).toBe(
            "Marketing preferences fixture child returned malformed JSON"
          );
          expect(errorMessage(thrown)).not.toContain(rawSentinel);
        }
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  }
);

test.serial(
  "rejects a nonzero fixture child even with a valid success response",
  async () => {
    await mkdir(artifactRoot, { recursive: true });
    const directory = await mkdtemp(
      join(artifactRoot, "marketing-preferences-nonzero-")
    );
    try {
      const outputDirectory = join(directory, "output");
      const result = await writeMockFixtureOutputs(outputDirectory);
      await withMockedFixtureChild(
        fixtureChildScript(JSON.stringify(result), 23),
        async () => {
          await expect(
            compileMarketingPreferencesFixture({
              appRoot,
              outputDirectory,
            })
          ).rejects.toThrow(
            "Marketing preferences fixture child exited with code 23"
          );
        }
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  }
);

test.serial(
  "rejects a fixture child success response whose JavaScript path escapes",
  async () => {
    await mkdir(artifactRoot, { recursive: true });
    const directory = await mkdtemp(
      join(artifactRoot, "marketing-preferences-path-containment-")
    );
    const rawSentinel = "synthetic-escaping-javascript-path";
    try {
      const outputDirectory = join(directory, "output");
      const result = await writeMockFixtureOutputs(outputDirectory);
      const escapingJavascriptPath = join(directory, `${rawSentinel}.js`);
      await writeFile(
        escapingJavascriptPath,
        "const outside = true;\n",
        "utf8"
      );
      await withMockedFixtureChild(
        fixtureChildScript(
          JSON.stringify({ ...result, javascriptPath: escapingJavascriptPath })
        ),
        async () => {
          let thrown: unknown;
          try {
            await compileMarketingPreferencesFixture({
              appRoot,
              outputDirectory,
            });
          } catch (cause) {
            thrown = cause;
          }

          expect(errorMessage(thrown)).toBe(
            "Marketing preferences JavaScript output path escapes the output directory"
          );
          expect(errorMessage(thrown)).not.toContain(rawSentinel);
        }
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  }
);

test.serial(
  "rejects fixture-child stdout overflow without leaking its raw sentinel",
  async () => {
    await mkdir(artifactRoot, { recursive: true });
    const directory = await mkdtemp(
      join(artifactRoot, "marketing-preferences-stdout-overflow-")
    );
    const rawSentinel = "synthetic-stdout-overflow-sentinel";
    try {
      await withMockedFixtureChild(
        `process.stdout.write("x".repeat(${64 * 1024 + 1}) + ${JSON.stringify(rawSentinel)});`,
        async () => {
          let thrown: unknown;
          try {
            await compileMarketingPreferencesFixture({
              appRoot,
              outputDirectory: join(directory, "output"),
            });
          } catch (cause) {
            thrown = cause;
          }

          expect(errorMessage(thrown)).toBe(
            "Marketing preferences fixture child stdout failed"
          );
          expect(errorMessage(thrown)).not.toContain(rawSentinel);
        }
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  }
);

test.serial("sanitizes a structured fixture-child error response", async () => {
  await mkdir(artifactRoot, { recursive: true });
  const directory = await mkdtemp(
    join(artifactRoot, "marketing-preferences-structured-error-")
  );
  const rawValues = [
    "synthetic-structured-password",
    "synthetic-structured-query",
    "synthetic-structured-environment",
  ];
  try {
    const structuredMessage =
      `https://synthetic-user:${rawValues[0]}@example.test/?token=${rawValues[1]}\n` +
      `DATABASE_URL=${rawValues[2]}`;
    await withMockedFixtureChild(
      fixtureChildScript(
        JSON.stringify({ message: structuredMessage, status: "error" }),
        1
      ),
      async () => {
        let thrown: unknown;
        try {
          await compileMarketingPreferencesFixture({
            appRoot,
            outputDirectory: join(directory, "output"),
          });
        } catch (cause) {
          thrown = cause;
        }

        const message = errorMessage(thrown);
        expect(message).toContain(
          "https://[REDACTED]@example.test/?token=[REDACTED]"
        );
        expect(message).toContain("DATABASE_URL=[REDACTED]");
        for (const rawValue of rawValues) {
          expect(message).not.toContain(rawValue);
        }
      }
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test.serial(
  "compiles the marketing preferences fixture in an isolated child process",
  async () => {
    await mkdir(artifactRoot, { recursive: true });
    const outputDirectory = await mkdtemp(
      join(artifactRoot, "marketing-preferences-child-boundary-")
    );
    const parentBuild = spyOn(Bun, "build").mockImplementation(async () => {
      throw new AggregateError(
        [
          {
            message:
              "parent DATABASE_URL=synthetic-parent-compiler-fault should never be observed",
            position: {
              column: 2,
              file: "https://synthetic-user:synthetic-password@example.test/parent.tsx?token=synthetic-query-value",
              line: 7,
            },
          },
        ],
        "synthetic parent compiler fault"
      );
    });

    try {
      const fixture = await compileMarketingPreferencesFixture({
        appRoot,
        outputDirectory,
      });
      const javascript = await readFile(fixture.javascriptPath, "utf8");
      const css = await readFile(fixture.cssPath);
      const schedulerStats = await stat(fixture.scheduler.path);
      const schedulerBytes = await readFile(fixture.scheduler.path);
      const schedulerMarker = "unstable_scheduleCallback";
      const schedulerSource = await readFile(
        join(appRoot, "node_modules/scheduler/cjs/scheduler.production.js"),
        "utf8"
      );

      expect(parentBuild).not.toHaveBeenCalled();
      expect(schedulerStats.isFile()).toBe(true);
      expect(schedulerBytes.byteLength).toBe(fixture.scheduler.bytes);
      expect(schedulerSource).toContain(schedulerMarker);
      expect(javascript).toContain(schedulerMarker);
      expect(css.byteLength).toBeGreaterThan(0);
    } finally {
      parentBuild.mockRestore();
      await rm(outputDirectory, { force: true, recursive: true });
    }
  }
);

type MarketingPreferencesBrowserReport = {
  readonly browser: {
    readonly locales: readonly string[];
    readonly viewports: readonly {
      readonly height: number;
      readonly name: string;
      readonly width: number;
    }[];
  };
  readonly problems: {
    readonly consoleErrors: readonly string[];
    readonly externalRequests: readonly string[];
    readonly pageErrors: readonly string[];
  };
  readonly screenshots: readonly {
    readonly locale: string;
    readonly viewport: string;
  }[];
  readonly status: string;
};

const probeStdoutLimit = 1024;

const readBoundedProbeStdout = async (
  stream: ReadableStream<Uint8Array>
): Promise<string> => {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > probeStdoutLimit) {
        throw new Error("marketing preferences deadline probe stdout overflow");
      }
      chunks.push(next.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }

  const output = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(output);
};

const nativeDeadlineProbeScript = ({
  appRoot,
  fixtureModuleUrl,
  globalRegistratorModuleUrl,
  outputDirectory,
}: {
  readonly appRoot: string;
  readonly fixtureModuleUrl: string;
  readonly globalRegistratorModuleUrl: string;
  readonly outputDirectory: string;
}): string => `import {
  clearTimeout as clearNativeTimeout,
  setTimeout as setNativeTimeout,
} from "node:timers";

const { GlobalRegistrator } = await import(${JSON.stringify(globalRegistratorModuleUrl)});
const { compileMarketingPreferencesFixture } = await import(${JSON.stringify(fixtureModuleUrl)});
const appRoot = ${JSON.stringify(appRoot)};
const outputDirectory = ${JSON.stringify(outputDirectory)};
const expectedTimeout = "Marketing preferences fixture child timed out after 50ms";
const originalSpawn = Bun.spawn;
const pinnedSpawn = Bun.spawn.bind(Bun);
let spawnedChild;
let registered = false;
let unregisterStarted = false;
let unregisterPromise = Promise.resolve();
let unregisterTimer;
let watchdogTimer;
let status = "unexpected";

const startUnregister = () => {
  if (!registered || unregisterStarted) return;
  unregisterStarted = true;
  unregisterPromise = Promise.resolve(GlobalRegistrator.unregister());
};

try {
  Bun.spawn = (_command, options) => {
    spawnedChild = pinnedSpawn(
      [process.execPath, "-e", "await new Promise(() => {})"],
      options
    );
    return spawnedChild;
  };
  GlobalRegistrator.register({ url: "https://marketing-preferences.example.test/" });
  registered = true;
  unregisterTimer = setNativeTimeout(startUnregister, 10);

  const result = await Promise.race([
    compileMarketingPreferencesFixture({
      appRoot,
      outputDirectory,
      timeoutMs: 50,
    }).then(
      () => ({ kind: "fulfilled" }),
      (cause) => ({
        kind: "rejected",
        message: cause instanceof Error ? cause.message : String(cause),
      })
    ),
    new Promise((resolve) => {
      watchdogTimer = setNativeTimeout(() => resolve({ kind: "watchdog" }), 500);
    }),
  ]);

  if (result.kind === "rejected" && result.message === expectedTimeout) {
    status = "timed-out";
  } else if (result.kind === "watchdog") {
    status = "watchdog";
  }
} finally {
  if (unregisterTimer !== undefined) clearNativeTimeout(unregisterTimer);
  if (watchdogTimer !== undefined) clearNativeTimeout(watchdogTimer);
  if (registered && !unregisterStarted) startUnregister();
  try {
    if (spawnedChild !== undefined) {
      try {
        spawnedChild.kill("SIGKILL");
      } catch {}
      await spawnedChild.exited.catch(() => undefined);
    }
  } finally {
    try {
      await unregisterPromise;
    } finally {
      Bun.spawn = originalSpawn;
    }
  }
}

process.stdout.write(JSON.stringify({ status }) + "\\n");
process.exitCode = status === "timed-out" ? 0 : 1;
`;

const terminateProbeChild = async (
  child: Bun.Subprocess,
  exitPromise: Promise<number>
): Promise<void> => {
  try {
    child.kill("SIGKILL");
  } catch {
    // The probe may have exited between the watchdog and cleanup.
  }
  await exitPromise.catch(() => undefined);
};

test.serial(
  "keeps fixture deadline cancellation native across Happy DOM",
  async () => {
    await mkdir(artifactRoot, { recursive: true });
    const directory = await mkdtemp(
      join(artifactRoot, "marketing-preferences-native-deadline-")
    );
    const probePath = join(directory, "native-deadline-probe.ts");
    const outputDirectory = join(directory, "output");
    await writeFile(
      probePath,
      nativeDeadlineProbeScript({
        appRoot,
        fixtureModuleUrl: pathToFileURL(
          join(import.meta.dir, "marketing-preferences-fixture.ts")
        ).href,
        globalRegistratorModuleUrl: pathToFileURL(
          createRequire(join(appRoot, "package.json")).resolve(
            "@happy-dom/global-registrator"
          )
        ).href,
        outputDirectory,
      }),
      "utf8"
    );

    let child: Bun.Subprocess | undefined;
    let exitPromise: Promise<number> | undefined;
    let watchdogTimer: ReturnType<typeof setNativeTimeout> | undefined;
    try {
      child = Bun.spawn([process.execPath, "run", probePath], {
        cwd: appRoot,
        stderr: "ignore",
        stdin: "ignore",
        stdout: "pipe",
      });
      exitPromise = child.exited;
      if (!(child.stdout instanceof ReadableStream)) {
        throw new Error(
          "marketing preferences deadline probe stdout unavailable"
        );
      }
      const result = await Promise.race([
        Promise.all([exitPromise, readBoundedProbeStdout(child.stdout)]).then(
          ([exitCode, stdout]) => ({
            exitCode,
            kind: "completed" as const,
            stdout,
          })
        ),
        new Promise<{ readonly kind: "watchdog" }>((resolve) => {
          watchdogTimer = setNativeTimeout(
            () => resolve({ kind: "watchdog" }),
            5_000
          );
        }),
      ]);

      if (result.kind === "watchdog") {
        throw new Error(
          "marketing preferences deadline probe watchdog expired"
        );
      }
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ status: "timed-out" });
    } finally {
      if (watchdogTimer !== undefined) clearNativeTimeout(watchdogTimer);
      if (child !== undefined && exitPromise !== undefined) {
        await terminateProbeChild(child, exitPromise);
      }
      await rm(directory, { force: true, recursive: true });
    }
  }
);

test.serial.skipIf(!chromiumAvailable)(
  "renders marketing preference states and exercises controlled browser flows",
  async () => {
    const fixture = await verifyMarketingPreferencesBrowserFixture({
      appRoot,
      outputDirectory: artifactRoot,
    });
    const reportBytes = await readFile(fixture.reportPath, "utf8");
    const log = await readFile(fixture.logPath, "utf8");
    const report = JSON.parse(reportBytes) as MarketingPreferencesBrowserReport;

    expect((await stat(fixture.reportPath)).isFile()).toBe(true);
    expect((await stat(fixture.logPath)).isFile()).toBe(true);
    expect(reportBytes.length).toBeGreaterThan(0);
    expect(log.length).toBeGreaterThan(0);
    expect(report.status).toBe("passed");
    expect(report.screenshots).toHaveLength(126);
    expect([...new Set(report.browser.locales)].sort()).toEqual([
      "cs-CZ",
      "en-US",
    ]);
    expect(
      [...new Set(report.browser.viewports.map(({ width }) => width))].sort(
        (left, right) => left - right
      )
    ).toEqual([320, 375, 1280]);
    expect(
      [...new Set(report.screenshots.map(({ locale }) => locale))].sort()
    ).toEqual(["cs-CZ", "en-US"]);
    expect(
      [...new Set(report.screenshots.map(({ viewport }) => viewport))].sort()
    ).toEqual(["320", "375", "desktop"]);
    expect(report.problems).toEqual({
      consoleErrors: [],
      externalRequests: [],
      pageErrors: [],
    });
    expect(log).toContain("scope=component-only controlled renderer");
    expect(log).toContain("state en-US/320/pending-link");
    expect(log).toContain(
      "context-replacement-reset cs-CZ/desktop/link-absent"
    );
  },
  300_000
);
