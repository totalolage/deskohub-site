import { expect, test } from "bun:test";
import { join } from "node:path";
import { resolveModulePath, transformGlobalsCss } from "./app-module-build";

const appRoot = join(import.meta.dir, "..", "..");
const globalsCssPath = join(appRoot, "app", "globals.css");

test("resolves a bare module path through its extension", async () => {
  const resolved = await resolveModulePath(
    join(appRoot, "features/account/customer-account")
  );
  expect(resolved).toBe(join(appRoot, "features/account/customer-account.ts"));
});

test("resolves a directory module through its index file", async () => {
  const resolved = await resolveModulePath(join(appRoot, "features/i18n"));
  expect(resolved).toBe(join(appRoot, "features/i18n/index.ts"));
});

test("rejects a module that does not exist", async () => {
  expect(
    resolveModulePath(join(appRoot, "features/account/does-not-exist"))
  ).rejects.toThrow("Could not resolve module:");
});

test("transforms the real globals.css through the app PostCSS config", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(globalsCssPath, "utf8");

  const transformed = await transformGlobalsCss(globalsCssPath, appRoot);

  expect(transformed.loader).toBe("css");
  expect(transformed.resolveDir).toBe(appRoot);
  // Tailwind compiled the source instead of passing the raw file through.
  expect(transformed.contents.length).toBeGreaterThan(source.length);
  expect(transformed.contents).not.toContain('@import "tailwindcss"');
  expect(transformed.contents).toContain(":root");
});
