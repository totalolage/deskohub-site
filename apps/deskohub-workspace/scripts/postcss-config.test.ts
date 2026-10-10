import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCommand } from "./shared/command";

const workspaceRoot = join(import.meta.dir, "..");

test("typecheck includes the PostCSS config", async () => {
  const result = await runCommand(
    ["bunx", "tsc", "--showConfig", "-p", "tsconfig.json"],
    { cwd: workspaceRoot }
  );

  expect(result.exitCode).toBe(0);
  const config = JSON.parse(result.stdout) as {
    readonly files: readonly string[];
  };
  expect(config.files).toContain("./postcss.config.mjs");
});

test("the PostCSS type rejects an invalid plugin value", async () => {
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
    const result = await runCommand(
      [
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
      { cwd: workspaceRoot }
    );

    expect(result.exitCode).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain(
      "Type '{ \"@tailwindcss/postcss\": string; }' is not assignable"
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
