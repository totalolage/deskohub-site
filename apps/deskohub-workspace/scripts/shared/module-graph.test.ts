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
      "export const entry: Shape = { view, Effect };",
    ].join("\n")
  );
  await writeFile(join(root, "types.ts"), 'import "server-only";');
  await writeFile(
    join(root, "nested", "view.tsx"),
    'import { useState } from "react";\nexport const view = useState;'
  );
});

afterAll(async () => {
  await rm(root, { force: true, recursive: true });
});

describe("runtimeImportGraph", () => {
  test("follows app imports transitively and stops at packages", async () => {
    const graph = await runtimeImportGraph(join(root, "entry.ts"), root);

    expect(graph.modules).toEqual(["entry.ts", "nested/view.tsx"]);
    expect(graph.packages).toEqual(["effect", "react"]);
  });
});
