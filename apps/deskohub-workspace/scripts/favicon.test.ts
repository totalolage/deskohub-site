import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const workspaceRoot = join(import.meta.dir, "..");

test("Workspace metadata advertises the generated PNG favicon", () => {
  const metadata = readFileSync(
    join(workspaceRoot, "app/[locale]/layout.tsx"),
    "utf8"
  );

  expect(metadata).toMatch(
    /icons:\s*\{\s*icon:\s*\{\s*url:\s*"\/favicon\.png",\s*type:\s*"image\/png",\s*sizes:\s*"512x512",\s*\},\s*\},/
  );
});

test("the SVG source applies both brand variants to its original mark", () => {
  const sourceSvg = readFileSync(
    join(workspaceRoot, "public/favicon.svg"),
    "utf8"
  );

  expect(sourceSvg).toMatch(/<g id="favicon" class="favicon" transform=/);
  expect(sourceSvg).toMatch(/\.favicon\s*\{\s*fill:\s*#00024F;/);
  expect(sourceSvg).toMatch(
    /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*\.favicon\s*\{\s*fill:\s*#D8D8D8;/
  );
});
