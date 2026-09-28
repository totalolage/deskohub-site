import { expect, test } from "bun:test";
import { assertCapturedSourcesMatchHead } from "./capture-avatar-states";

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
