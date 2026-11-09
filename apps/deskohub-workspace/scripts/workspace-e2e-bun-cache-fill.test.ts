import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { testEmailAddress } from "@deskohub/test-email";
import { commandOutput, runCommand } from "./shared/command";
import { findStepByName, parseWorkflow } from "./shared/workflow-contract";

const workflow = parseWorkflow(
  resolve(import.meta.dir, "../../../.github/workflows/workspace-e2e.yml")
);
const fillStep = findStepByName(
  workflow,
  "Fill Bun package cache from install manifests"
);

const packageName = "cache-fill-probe";
const packageVersion = "1.0.0";
const packageSource = "module.exports = 'registry content';\n";

// A security scanner is a bunfig.toml hook Bun loads even with
// --ignore-scripts. This one marks that it ran and plants a file in the cache.
const scannerSource = `
import { mkdirSync, writeFileSync } from "node:fs";
writeFileSync(import.meta.dir + "/scanner-ran", "");
mkdirSync(process.env.BUN_INSTALL_CACHE_DIR, { recursive: true });
writeFileSync(process.env.BUN_INSTALL_CACHE_DIR + "/planted-by-scanner", "");
export const scanner = { version: "1", scan: async () => [] };
`;

const writeTree = (root: string, files: Record<string, string>): void => {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
};

describe("Workspace E2E Bun cache fill", () => {
  const root = mkdtempSync(join(tmpdir(), "bun-cache-fill-"));
  const checkout = join(root, "checkout");
  const tarball = join(root, `${packageName}-${packageVersion}.tgz`);
  let registry: ReturnType<typeof Bun.serve>;

  // Isolated from the developer's Bun and Git configuration; the fake
  // registry stands in for the default one, so no test reaches the network.
  const environment = (cacheDir: string, runnerTemp = root) => ({
    PATH: process.env.PATH,
    HOME: join(root, "home"),
    XDG_CONFIG_HOME: join(root, "home", ".config"),
    BUN_CONFIG_REGISTRY: registry.url.href,
    BUN_INSTALL_CACHE_DIR: cacheDir,
    RUNNER_TEMP: runnerTemp,
  });

  const git = (...args: string[]) =>
    commandOutput(["git", ...args], {
      cwd: checkout,
      env: environment(join(root, "unused-cache")),
    });

  beforeAll(async () => {
    writeTree(join(root, "tarball"), {
      "package/package.json": JSON.stringify({
        name: packageName,
        version: packageVersion,
      }),
      "package/index.js": packageSource,
    });
    await commandOutput([
      "tar",
      "czf",
      tarball,
      "-C",
      join(root, "tarball"),
      "package",
    ]);
    const tarballBytes = readFileSync(tarball);
    const integrity = `sha512-${createHash("sha512").update(tarballBytes).digest("base64")}`;
    registry = Bun.serve({
      port: 0,
      fetch: (request) => {
        const { pathname } = new URL(request.url);
        if (pathname === `/${packageName}`) {
          return Response.json({
            name: packageName,
            "dist-tags": { latest: packageVersion },
            versions: {
              [packageVersion]: {
                name: packageName,
                version: packageVersion,
                dist: {
                  tarball: new URL(
                    `/${packageName}/-/${packageName}-${packageVersion}.tgz`,
                    registry.url
                  ).href,
                  integrity,
                },
              },
            },
          });
        }
        if (pathname.endsWith(".tgz")) return new Response(tarballBytes);
        return new Response("not found", { status: 404 });
      },
    });

    // An exact-SHA checkout whose lockfile matches its manifests, but which
    // also carries a scanner hook and a root lifecycle script.
    writeTree(checkout, {
      "package.json": JSON.stringify({
        name: "fixture",
        workspaces: ["packages/*"],
        scripts: { prepare: "touch prepare-ran" },
        dependencies: { member: "workspace:*" },
      }),
      "packages/member/package.json": JSON.stringify({
        name: "member",
        version: "1.0.0",
        dependencies: { [packageName]: packageVersion },
      }),
    });
    await commandOutput(["bun", "install", "--ignore-scripts"], {
      cwd: checkout,
      env: environment(join(root, "lockfile-cache")),
      timeoutMs: 60_000,
    });
    rmSync(join(checkout, "node_modules"), { recursive: true, force: true });
    rmSync(join(checkout, "packages/member/node_modules"), {
      recursive: true,
      force: true,
    });
    writeTree(checkout, {
      "bunfig.toml": '[install.security]\nscanner = "./scanner.ts"\n',
      "scanner.ts": scannerSource,
    });
    await git("init", "--quiet");
    await git("add", "--all");
    await git(
      "-c",
      "user.name=Fixture",
      "-c",
      `user.email=${testEmailAddress("fixture")}`,
      "commit",
      "--quiet",
      "--no-gpg-sign",
      "--message=fixture"
    );
  });

  afterAll(async () => {
    await registry?.stop(true);
    rmSync(root, { recursive: true, force: true });
  });

  test("an in-checkout install runs the exact-SHA scanner hook", async () => {
    // The pre-fix fill step, kept as a control that the fixture is armed.
    const cache = join(root, "control-cache");
    const result = await runCommand(
      ["bun", "install", "--frozen-lockfile", "--ignore-scripts"],
      { cwd: checkout, env: environment(cache), timeoutMs: 60_000 }
    );
    const scannerRan = existsSync(join(checkout, "scanner-ran"));
    // Restore the committed checkout for the fill test.
    await git("clean", "-dfxq");
    expect(result.exitCode).toBe(0);
    expect(scannerRan).toBe(true);
    expect(existsSync(join(cache, "planted-by-scanner"))).toBe(true);
  }, 120_000);

  test("fills the cache from the lockfile without running exact-SHA code", async () => {
    const cache = join(root, "fill-cache");
    const runnerTemp = mkdtempSync(join(root, "runner-temp-"));
    expect(fillStep?.run).toBeString();
    const result = await runCommand(["bash", "-c", fillStep?.run ?? ""], {
      cwd: checkout,
      env: environment(cache, runnerTemp),
      timeoutMs: 60_000,
    });
    expect(result.stderr).not.toContain("error:");
    expect(result.exitCode).toBe(0);

    // Neither the scanner hook nor the lifecycle script ran, and the
    // checkout gained no files.
    expect(existsSync(join(checkout, "scanner-ran"))).toBe(false);
    expect(existsSync(join(runnerTemp, "bun-cache-fill", "prepare-ran"))).toBe(
      false
    );
    expect(await git("status", "--porcelain", "--untracked-files=all")).toBe(
      ""
    );

    // The cache holds only the registry package, byte for byte. Bun names
    // the extracted entry after the non-default registry host.
    const cachePaths = readdirSync(cache, { recursive: true }).map(String);
    expect(
      cachePaths.filter((path) => path.endsWith("planted-by-scanner"))
    ).toEqual([]);
    const topLevel = readdirSync(cache).filter(
      (entry) => !entry.startsWith(".")
    );
    const extracted = topLevel.filter((entry) =>
      entry.startsWith(`${packageName}@${packageVersion}@`)
    );
    expect(extracted).toHaveLength(1);
    expect(topLevel.sort()).toEqual([packageName, ...extracted].sort());
    expect(
      readFileSync(join(cache, extracted[0] ?? "", "index.js"), "utf8")
    ).toBe(packageSource);

    // The checkout install that follows the save needs no registry.
    await registry.stop(true);
    const install = await runCommand(["bun", "install", "--frozen-lockfile"], {
      cwd: checkout,
      env: environment(cache, runnerTemp),
      timeoutMs: 60_000,
    });
    expect(install.exitCode).toBe(0);
    expect(
      readFileSync(
        join(checkout, "packages/member/node_modules", packageName, "index.js"),
        "utf8"
      )
    ).toBe(packageSource);
  }, 120_000);
});
