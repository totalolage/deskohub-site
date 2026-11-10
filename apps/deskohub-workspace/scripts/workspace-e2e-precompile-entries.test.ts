import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { runtimeImportGraph } from "@/shared/testing/runtime-import-graph.test-utils";

const workspaceRoot = resolve(import.meta.dir, "..");

// The Workspace E2E workflow runs these before `i18n:compile`, or after a
// failure in a tree that never compiled messages, so nothing they load may
// need Paraglide output. The Biome override in `biome.json` bans the direct
// imports; this follows every runtime import, since a module several steps
// away can reach the messages too.
const precompileEntries = [
  "workspace-e2e-account-state.ts",
  "workspace-e2e-capacity.ts",
  "workspace-e2e-stale-cleanup.ts",
];

const needsCompiledMessages = (module: string) =>
  module.split("/").includes("paraglide") ||
  /^features\/(administration\/)?i18n\/index\.ts$/.test(module);

test.each(precompileEntries)("%s loads no compiled messages", async (entry) => {
  const { modules } = await runtimeImportGraph(
    resolve(import.meta.dir, entry),
    workspaceRoot
  );

  expect(modules.length).toBeGreaterThan(1);
  expect(modules.filter(needsCompiledMessages)).toEqual([]);
});
