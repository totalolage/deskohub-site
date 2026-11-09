import { expect, test } from "bun:test";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  playwrightChromiumAvailable,
  resolvePlaywrightChromiumExecutable,
} from "./playwright-browser";

test("finds the hosted system browser when no path is configured", async () => {
  const directory = await mkdtemp(join(tmpdir(), "workspace-playwright-"));
  const executable = join(directory, "google-chrome");
  await writeFile(executable, "#!/bin/sh\n");
  await chmod(executable, 0o700);

  expect(await resolvePlaywrightChromiumExecutable(undefined, directory)).toBe(
    executable
  );
});

test("fails CI browser tests without Playwright Chromium", async () => {
  const error = await playwrightChromiumAvailable("/missing/chrome", true).then(
    () => null,
    (cause: unknown) => cause
  );

  expect(error).toBeInstanceOf(Error);
  expect(error).toHaveProperty(
    "message",
    expect.stringContaining("/missing/chrome")
  );
});
