import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commandOutput } from "../shared/command";
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

test("status collection detects untracked inputs despite status.showUntrackedFiles=no", async () => {
  const repository = mkdtempSync(join(tmpdir(), "avatar-status-check-"));
  const git = (...args: string[]) =>
    commandOutput(["git", ...args], { cwd: repository });
  try {
    await git("init", "-q");
    await git("config", "status.showUntrackedFiles", "no");
    const untrackedInput = join(repository, "untracked-build-input.ts");
    writeFileSync(untrackedInput, "export const probe = 1;\n");

    // Prove the config is actually honored by plain porcelain output,
    // so the regression below cannot pass vacuously.
    const hiddenOutput = await git("status", "--porcelain");
    expect(hiddenOutput.trim()).toBe("");

    const lines = await gitStatusPorcelainLines(repository);
    expect(lines).toEqual(["?? untracked-build-input.ts"]);
    expect(() => assertCapturedSourcesMatchHead(lines)).toThrow(
      /refusing to attribute a dirty tree to a clean commit/
    );
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});
