import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const actionsDirectory = new URL(".", import.meta.url);
const workspaceDirectory = fileURLToPath(new URL("../../../", import.meta.url));

describe("reservation Server Action boundaries", () => {
  test('export only async functions from modules marked "use server"', async () => {
    const actionFiles = (await readdir(actionsDirectory)).filter((file) =>
      file.endsWith(".ts")
    );
    const serverActionModules: string[] = [];

    for (const file of actionFiles) {
      const url = new URL(file, actionsDirectory);
      const source = await Bun.file(url).text();
      if (!source.startsWith('"use server";')) continue;

      serverActionModules.push(file);
      const check = Bun.spawn(
        [
          process.execPath,
          "--preload",
          "./shared/testing/workspace-test-env.ts",
          "-e",
          `
            const actionModule = await import(${JSON.stringify(url.href)});
            const invalidExports = Object.entries(actionModule)
              .filter(([, value]) =>
                typeof value !== "function" ||
                value.constructor.name !== "AsyncFunction"
              )
              .map(([name]) => name);
            if (invalidExports.length > 0) {
              console.error(invalidExports.join(", "));
              process.exit(1);
            }
          `,
        ],
        {
          cwd: workspaceDirectory,
          stderr: "pipe",
          stdout: "ignore",
        }
      );
      const stderr = await new Response(check.stderr).text();

      expect(
        await check.exited,
        `${file} has invalid Server Action exports: ${stderr.trim()}`
      ).toBe(0);
    }

    expect(serverActionModules.length).toBeGreaterThan(0);
  });
});
