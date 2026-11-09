import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  hashSources,
  measuresCurrentSource,
  readSourceManifest,
  type SourceManifest,
  stableHashes,
  writeSourceManifest,
} from "./source-manifest";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function repository(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "source-manifest-"));
  directories.push(root);
  for (const [path, contents] of Object.entries(files)) {
    writeFileSync(join(root, path), contents);
  }
  return root;
}

function manifestOf(root: string, paths: string[]): SourceManifest {
  return {
    revision: "abc123",
    generatedAt: "2026-11-02T10:00:00.000Z",
    scope: { kind: "complete" },
    testExitCode: 0,
    files: hashSources(
      root,
      paths.map((path) => join(root, path))
    ),
  };
}

test("a file still holding the recorded content is measured", () => {
  const root = repository({ "a.ts": "export const a = 1;\n" });
  expect(measuresCurrentSource(manifestOf(root, ["a.ts"]), root, "a.ts")).toBe(
    true
  );
});

test("a file edited after the run is not measured", () => {
  const root = repository({ "a.ts": "export const a = 1;\n" });
  const manifest = manifestOf(root, ["a.ts"]);
  writeFileSync(join(root, "a.ts"), "export const a = 2;\n");
  expect(measuresCurrentSource(manifest, root, "a.ts")).toBe(false);
});

test("a file the run didn't cover is not measured", () => {
  const root = repository({ "a.ts": "", "b.ts": "" });
  expect(measuresCurrentSource(manifestOf(root, ["a.ts"]), root, "b.ts")).toBe(
    false
  );
});

test("a file edited while the tests ran keeps no hash", () => {
  expect(
    stableHashes(
      { "a.ts": "1", "b.ts": "1", "c.ts": null },
      { "a.ts": "1", "b.ts": "2", "c.ts": null }
    )
  ).toEqual({ "a.ts": "1", "b.ts": null, "c.ts": null });
});

test("a written manifest reads back", () => {
  const root = repository({ "a.ts": "" });
  const manifest = manifestOf(root, ["a.ts"]);
  writeSourceManifest(root, manifest);
  expect(readSourceManifest(root)).toEqual(manifest);
});

test("a missing manifest asks for a coverage run", () => {
  const root = repository({});
  expect(() => readSourceManifest(root)).toThrow("bun run coverage");
});
