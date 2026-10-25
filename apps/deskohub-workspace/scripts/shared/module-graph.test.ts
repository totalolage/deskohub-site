import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runtimeImportGraph } from "./module-graph";

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "module-graph-"));
  await mkdir(join(root, "nested"));
  await writeFile(
    join(root, "entry.ts"),
    [
      'import type { Shape } from "./types";',
      'import { view } from "./nested/view";',
      'import { Effect } from "effect";',
      'export type { Hidden } from "./hidden";',
      'export { shared } from "./shared";',
      'export const load = () => import("./lazy");',
      "export const entry: Shape = { view, Effect };",
    ].join("\n")
  );
  await writeFile(join(root, "types.ts"), 'import "server-only";');
  await writeFile(join(root, "hidden.ts"), 'import "server-only";');
  await writeFile(join(root, "shared.ts"), "export const shared = 1;");
  await writeFile(join(root, "lazy.ts"), 'import "next/headers";');
  await writeFile(
    join(root, "nested", "view.tsx"),
    'import { useState } from "react";\nexport const view = useState;'
  );
});

afterAll(async () => {
  await rm(root, { force: true, recursive: true });
});

describe("runtimeImportGraph", () => {
  test("follows runtime imports, re-exports and dynamic imports", async () => {
    const graph = await runtimeImportGraph(join(root, "entry.ts"), root);

    expect(graph.modules).toEqual([
      "entry.ts",
      "lazy.ts",
      "nested/view.tsx",
      "shared.ts",
    ]);
    expect(graph.packages).toEqual(["effect", "next/headers", "react"]);
  });
});
