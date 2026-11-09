import { expect, test } from "bun:test";
import { join } from "node:path";
import { transformGlobalsCss } from "./app-module-build";

const appRoot = join(import.meta.dir, "..", "..");
const globalsCssPath = join(appRoot, "app", "globals.css");

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
