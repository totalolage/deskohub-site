import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyMobileWebApp } from "./build-mobile-web-app";
import {
  assertMobileWebAppExported,
  mobileWebAppEntryFiles,
} from "./mobile-web-app-export.js";

let root: string;
let exportDirectory: string;
let targetDirectory: string;

const writeExport = (files: readonly string[]) => {
  for (const file of files) {
    const path = join(exportDirectory, file);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, `export ${file}`);
  }
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mobile-web-app-"));
  exportDirectory = join(root, "dist");
  targetDirectory = join(root, "public/app");
  mkdirSync(exportDirectory, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

test("replaces the served app with the export, dropping stale files", async () => {
  writeExport([...mobileWebAppEntryFiles, "_expo/static/js/web/entry-new.js"]);
  mkdirSync(join(targetDirectory, "_expo"), { recursive: true });
  writeFileSync(join(targetDirectory, "_expo/entry-old.js"), "old");

  await copyMobileWebApp({ exportDirectory, targetDirectory });

  expect(
    readFileSync(
      join(targetDirectory, "_expo/static/js/web/entry-new.js"),
      "utf8"
    )
  ).toBe("export _expo/static/js/web/entry-new.js");
  expect(existsSync(join(targetDirectory, "_expo/entry-old.js"))).toBe(false);
  expect(() => assertMobileWebAppExported(targetDirectory)).not.toThrow();
});

test("refuses an export without the app shell and keeps the served app", async () => {
  writeExport(["index.html", "manifest.webmanifest"]);
  mkdirSync(targetDirectory, { recursive: true });
  writeFileSync(join(targetDirectory, "index.html"), "served");

  await expect(
    copyMobileWebApp({ exportDirectory, targetDirectory })
  ).rejects.toThrow(/sw\.js, offline\.html/);
  expect(readFileSync(join(targetDirectory, "index.html"), "utf8")).toBe(
    "served"
  );
});

test("fails the production build when public/app lacks the export", () => {
  expect(() => assertMobileWebAppExported(targetDirectory)).toThrow(
    /mobile-web-app:build/
  );
});

// Vercel skips a project when a commit changes no package in its dependency
// graph, and the Workspace serves the mobile app's web export.
test("mobile app changes deploy the Workspace", async () => {
  const manifest: { devDependencies: Record<string, string> } = await Bun.file(
    join(import.meta.dir, "../../package.json")
  ).json();

  expect(manifest.devDependencies["deskohub-mobile"]).toBe("workspace:*");
});
