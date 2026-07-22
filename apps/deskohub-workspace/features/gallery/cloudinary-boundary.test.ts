import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";

const workspaceRoot = resolve(import.meta.dir, "../..");
const cloudinaryServerModule = "@deskohub/cloudinary" + "/server";

const allowedServerImports = new Set([
  "app/api/webhooks/cloudinary/route.ts",
  "features/gallery/backend/cloudinary-images.ts",
  "features/gallery/backend/cloudinary.service.ts",
]);

test("Cloudinary server reads stay behind cached workspace boundaries", async () => {
  const offenders: string[] = [];

  for (const filePath of await listSourceFiles(workspaceRoot)) {
    const contents = await readFile(filePath, "utf8");

    if (!contents.includes(cloudinaryServerModule)) continue;

    const relativePath = relative(workspaceRoot, filePath);
    if (!allowedServerImports.has(relativePath)) offenders.push(relativePath);
  }

  expect(offenders).toEqual([]);
});

async function listSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.flatMap((entry) => {
      if (entry.name === "node_modules" || entry.name === ".next") return [];

      const path = resolve(directory, entry.name);

      if (entry.isDirectory()) return listSourceFiles(path);
      if ([".ts", ".tsx"].includes(extname(entry.name))) return [path];

      return [];
    })
  );

  return files.flat();
}
