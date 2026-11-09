import { afterAll, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runCommand } from "./shared/command";
import { parseCompositeAction } from "./shared/workflow-contract";

const action = parseCompositeAction(
  resolve(
    import.meta.dir,
    "../../../.github/actions/restore-playwright-webkit/action.yml"
  )
);
const resolveVersionRun = (): string => {
  const run = action.runs.steps.find(
    (step) => step.name === "Resolve Workspace Playwright version"
  )?.run;
  expect(run).toBeString();
  return run ?? "";
};

const repositoryRoot = resolve(import.meta.dir, "../../..");

describe("restore-playwright-webkit action", () => {
  const root = mkdtempSync(join(tmpdir(), "restore-playwright-webkit-"));

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // Runs the version step the way the composite action does: from the
  // checkout root, writing its outputs to GITHUB_OUTPUT.
  const resolveVersion = async (
    checkout: string,
    env: Readonly<Record<string, string>> = { ImageOS: "ubuntu24" }
  ) => {
    const output = join(
      root,
      `output-${Math.random().toString(36).slice(2)}.txt`
    );
    writeFileSync(output, "");
    const result = await runCommand(["bash", "-c", resolveVersionRun()], {
      cwd: checkout,
      env: { PATH: process.env.PATH, GITHUB_OUTPUT: output, ...env },
      timeoutMs: 30_000,
    });
    return { exitCode: result.exitCode, outputs: readFileSync(output, "utf8") };
  };

  const checkoutWith = (scenario: string, manifest: string) => {
    const checkout = join(root, scenario);
    mkdirSync(join(checkout, "apps", "deskohub-workspace"), {
      recursive: true,
    });
    writeFileSync(
      join(checkout, "apps", "deskohub-workspace", "package.json"),
      manifest
    );
    return checkout;
  };

  test("reads the Workspace's own Playwright pin, the version its install resolves", async () => {
    const result = await resolveVersion(repositoryRoot);
    expect(result.exitCode).toBe(0);
    // The restored WebKit build is the one the installed Playwright expects.
    const installed = (
      JSON.parse(
        readFileSync(
          resolve(
            repositoryRoot,
            "apps/deskohub-workspace/node_modules/@playwright/test/package.json"
          ),
          "utf8"
        )
      ) as { version: string }
    ).version;
    expect(result.outputs).toBe(`version=${installed}\nimage-os=ubuntu24\n`);
  });

  test("refuses a version range, which names no single WebKit build", async () => {
    const checkout = checkoutWith(
      "range",
      JSON.stringify({ devDependencies: { "@playwright/test": "^1.61.1" } })
    );
    const result = await resolveVersion(checkout);
    expect(result.exitCode).not.toBe(0);
    expect(result.outputs).toBe("");
  });

  test("refuses a missing pin", async () => {
    const checkout = checkoutWith(
      "missing",
      JSON.stringify({ devDependencies: {} })
    );
    const result = await resolveVersion(checkout);
    expect(result.exitCode).not.toBe(0);
    expect(result.outputs).toBe("");
  });

  test("refuses a pin that would add text to the cache key", async () => {
    const checkout = checkoutWith(
      "injected",
      JSON.stringify({
        devDependencies: { "@playwright/test": "1.61.1\nversion=0.0.0" },
      })
    );
    const result = await resolveVersion(checkout);
    expect(result.exitCode).not.toBe(0);
    expect(result.outputs).toBe("");
  });

  test("refuses to run without the runner image name the key holds", async () => {
    const checkout = checkoutWith(
      "no-image",
      JSON.stringify({ devDependencies: { "@playwright/test": "1.61.1" } })
    );
    const result = await resolveVersion(checkout, {});
    expect(result.exitCode).not.toBe(0);
    expect(result.outputs).toBe("");
  });
});
