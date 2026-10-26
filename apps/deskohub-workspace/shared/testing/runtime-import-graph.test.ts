import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runtimeImportGraph } from "./runtime-import-graph.test-utils";

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "runtime-import-graph-"));
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
    join(root, "form.tsx"),
    'import { save } from "./actions";\nexport const form = save;'
  );
  await writeFile(
    join(root, "actions.ts"),
    '"use server";\nimport { shared } from "./shared";\nexport const save = async () => shared;'
  );
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

  test("joins the graphs of several entries", async () => {
    const graph = await runtimeImportGraph(
      [join(root, "lazy.ts"), join(root, "shared.ts")],
      root
    );

    expect(graph.modules).toEqual(["lazy.ts", "shared.ts"]);
    expect(graph.packages).toEqual(["next/headers"]);
  });

  test("neither loads nor follows a module it only references", async () => {
    const graph = await runtimeImportGraph(join(root, "form.tsx"), root, {
      isReference: (sourceText) => sourceText.startsWith('"use server"'),
    });

    expect(graph.modules).toEqual(["form.tsx"]);
  });
});
