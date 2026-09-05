import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const workspaceRoot = join(import.meta.dir, "..");
const decoder = new TextDecoder();

test("typecheck includes the PostCSS config", () => {
  const result = Bun.spawnSync({
    cmd: ["bunx", "tsc", "--showConfig", "-p", "tsconfig.json"],
    cwd: workspaceRoot,
    stdout: "pipe",
    stderr: "pipe",
  });

  expect(result.exitCode).toBe(0);
  const config = JSON.parse(decoder.decode(result.stdout)) as {
    readonly files: readonly string[];
  };
  expect(config.files).toContain("./postcss.config.mjs");
});

test("the PostCSS type rejects an invalid plugin value", () => {
  const directory = mkdtempSync(join(workspaceRoot, ".postcss-config-"));
  const fixture = join(directory, "postcss.config.mjs");

  try {
    writeFileSync(
      fixture,
      readFileSync(join(workspaceRoot, "postcss.config.mjs"), "utf8").replace(
        '"@tailwindcss/postcss": {},',
        '"@tailwindcss/postcss": "invalid",'
      )
    );
    const result = Bun.spawnSync({
      cmd: [
        "bunx",
        "tsc",
        "--noEmit",
        "--ignoreConfig",
        "--pretty",
        "false",
        "--allowJs",
        "--module",
        "esnext",
        "--moduleResolution",
        "bundler",
        "--target",
        "ES2022",
        "--skipLibCheck",
        fixture,
      ],
      cwd: workspaceRoot,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).not.toBe(0);
    expect(
      `${decoder.decode(result.stdout)}${decoder.decode(result.stderr)}`
    ).toContain(
      "Type '{ \"@tailwindcss/postcss\": string; }' is not assignable"
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
