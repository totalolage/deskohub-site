import { expect, test } from "bun:test";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolvePlaywrightChromiumExecutable } from "./playwright-browser";

test("uses the explicitly configured Playwright browser", async () => {
  expect(
    await resolvePlaywrightChromiumExecutable("/configured/chrome", undefined)
  ).toBe("/configured/chrome");
});

test("finds the hosted system browser when no path is configured", async () => {
  const directory = await mkdtemp(join(tmpdir(), "workspace-playwright-"));
  const executable = join(directory, "google-chrome");
  await writeFile(executable, "#!/bin/sh\n");
  await chmod(executable, 0o700);

  expect(await resolvePlaywrightChromiumExecutable(undefined, directory)).toBe(
    executable
  );
});

test("lets Playwright fall back to its bundled browser", async () => {
  expect(
    await resolvePlaywrightChromiumExecutable(undefined, "/missing")
  ).toBeUndefined();
});
