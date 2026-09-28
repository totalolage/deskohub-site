import { expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertCapturedSourcesMatchHead,
  gitStatusPorcelainLines,
} from "./capture-avatar-states";

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
