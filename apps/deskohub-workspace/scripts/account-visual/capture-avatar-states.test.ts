import { expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertCapturedSourcesMatchHead,
  avatarVisualCaptureChecklist,
  gitStatusPorcelainLines,
} from "./capture-avatar-states";

test("avatar visual checklist covers hidden, fallback, and mutation states responsively", () => {
  expect(avatarVisualCaptureChecklist.hidden).toMatchObject({
    states: ["hidden-profile"],
    viewports: ["desktop", "tablet", "mobile"],
    locales: ["en-US", "cs-CZ"],
  });
  expect(avatarVisualCaptureChecklist.available).toMatchObject({
    states: [
      "fallback",
      "pending-upload",
      "uploaded",
      "upload-error",
      "pending-remove",
      "removed",
    ],
    viewports: ["desktop", "tablet", "mobile"],
    locales: ["en-US", "cs-CZ"],
  });
});

test("capture refuses a dirty working tree attributed to a clean commit", () => {
  expect(() =>
    assertCapturedSourcesMatchHead([" M apps/deskohub-workspace/whatever.tsx"])
  ).toThrow(/refusing to attribute a dirty tree to a clean commit/);
  expect(() =>
    assertCapturedSourcesMatchHead(["?? new-build-input.ts"])
  ).toThrow(/refusing to attribute a dirty tree to a clean commit/);
  expect(() => assertCapturedSourcesMatchHead(["M  staged-only.tsx"])).toThrow(
    /refusing to attribute a dirty tree to a clean commit/
  );
});

test("capture accepts a working tree identical to HEAD", () => {
  expect(() => assertCapturedSourcesMatchHead([])).not.toThrow();
});

test("capture excludes the preserved workspace example env file only", () => {
  expect(() =>
    assertCapturedSourcesMatchHead([" M apps/deskohub-workspace/.env.example"])
  ).not.toThrow();
  expect(() =>
    assertCapturedSourcesMatchHead([
      "M  apps/deskohub-workspace/.env.example",
      "MM apps/deskohub-workspace/.env.example",
    ])
  ).not.toThrow();
  expect(() =>
    assertCapturedSourcesMatchHead([
      " M apps/deskohub-workspace/.env.example.copy",
    ])
  ).toThrow(/refusing to attribute a dirty tree to a clean commit/);
  expect(() =>
    assertCapturedSourcesMatchHead([" D apps/deskohub-workspace/.env.example"])
  ).toThrow(/refusing to attribute a dirty tree to a clean commit/);
  expect(() =>
    assertCapturedSourcesMatchHead([
      "R  apps/deskohub-workspace/.env.example -> apps/deskohub-workspace/renamed.example",
    ])
  ).toThrow(/refusing to attribute a dirty tree to a clean commit/);
  expect(() =>
    assertCapturedSourcesMatchHead([
      " M apps/deskohub-workspace/.env.example",
      "?? apps/deskohub-workspace/scripts/new-build-input.ts",
    ])
  ).toThrow(/apps\/deskohub-workspace\/scripts\/new-build-input.ts/);
});

test("status collection detects untracked inputs despite status.showUntrackedFiles=no", () => {
  const repository = mkdtempSync(join(tmpdir(), "avatar-status-check-"));
  try {
    execSync("git init -q", { cwd: repository });
    execSync("git config status.showUntrackedFiles no", { cwd: repository });
    const untrackedInput = join(repository, "untracked-build-input.ts");
    writeFileSync(untrackedInput, "export const probe = 1;\n");

    // Prove the config is actually honored by plain porcelain output,
    // so the regression below cannot pass vacuously.
    const hiddenOutput = execSync("git status --porcelain", {
      cwd: repository,
    }).toString();
    expect(hiddenOutput.trim()).toBe("");

    const lines = gitStatusPorcelainLines(repository);
    expect(lines).toEqual(["?? untracked-build-input.ts"]);
    expect(() => assertCapturedSourcesMatchHead(lines)).toThrow(
      /refusing to attribute a dirty tree to a clean commit/
    );
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("status collection omits ignored task artifacts", () => {
  const repository = mkdtempSync(join(tmpdir(), "avatar-status-check-"));
  try {
    execSync("git init -q", { cwd: repository });
    writeFileSync(
      join(repository, ".git/info/exclude"),
      "task-output-artifact\n"
    );
    writeFileSync(join(repository, "task-output-artifact"), "synthetic\n");

    expect(gitStatusPorcelainLines(repository)).toEqual([]);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});
