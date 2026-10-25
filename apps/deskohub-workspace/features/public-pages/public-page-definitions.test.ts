import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { runtimeImportGraph } from "@/shared/testing/runtime-import-graph.test-utils";

const workspaceRoot = resolve(import.meta.dir, "../..");
const renderingPackage = /^(react|react-dom|server-only|next)(\/|$)/;

test("the registry loads no rendering or server-only modules", async () => {
  const { modules, packages } = await runtimeImportGraph(
    resolve(import.meta.dir, "public-page-definitions.ts"),
    workspaceRoot
  );

  expect(modules.length).toBeGreaterThan(1);
  expect(modules.filter((module) => module.endsWith(".tsx"))).toEqual([]);
  expect(packages.filter((name) => renderingPackage.test(name))).toEqual([]);
});
