import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { runtimeImportGraph } from "@/shared/testing/runtime-import-graph.test-utils";

const workspaceRoot = resolve(import.meta.dir, "../..");

test("the gate decided per run loads neither React nor the Next.js request edge", async () => {
  const { modules, packages } = await runtimeImportGraph(
    resolve(import.meta.dir, "referral-release-gate-run.ts"),
    workspaceRoot
  );

  expect(modules.length).toBeGreaterThan(1);
  expect(packages.filter((name) => /^react(\/|$)/.test(name))).toEqual([]);
  // The Next.js edge decides through React `cache` and a nested runner.
  expect(
    modules.filter((module) => /release-gates?\.server\.ts$/.test(module))
  ).toEqual([]);
});
