import { expect, test } from "bun:test";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const sourcePaths = [
  ...new Bun.Glob("{apps,packages}/**/*.{ts,tsx}").scanSync({
    cwd: repositoryRoot,
    absolute: true,
  }),
].filter(
  (path) =>
    !path.includes("/node_modules/") &&
    !path.includes("/generated/") &&
    !path.includes("/.next/")
);

test("Context capabilities own their default and live layers", async () => {
  expect(sourcePaths.length).toBeGreaterThan(0);
  const sources = await Promise.all(
    sourcePaths.map(
      async (path) => [path, await Bun.file(path).text()] as const
    )
  );
  const capabilities = new Set<string>();
  const capabilityDeclaration =
    /\bclass\s+([A-Z][A-Za-z0-9]*)\s+extends\s+Context\.Service\b|\bconst\s+([A-Z][A-Za-z0-9]*)\s*=\s*Context\.Service\b/g;

  for (const [, source] of sources) {
    for (const match of source.matchAll(capabilityDeclaration)) {
      capabilities.add(match[1] ?? match[2]);
    }
  }

  const standaloneLayer =
    /\b(?:declare\s+)?const\s+([A-Z][A-Za-z0-9]*?)(Default|Live(?:WithDependencies)?)\b/g;
  const offenders: string[] = [];

  for (const [path, source] of sources) {
    for (const match of source.matchAll(standaloneLayer)) {
      if (capabilities.has(match[1])) {
        offenders.push(
          `${relative(repositoryRoot, path)}: ${match[1]}${match[2]}`
        );
      }
    }
  }

  expect(offenders.sort()).toEqual([]);
});

test("fully wired capability layers are named Live", async () => {
  const obsoleteName = ["Live", "With", "Dependencies"].join("");
  const offenders = (
    await Promise.all(
      sourcePaths.map(async (path) => ({
        path,
        source: await Bun.file(path).text(),
      }))
    )
  )
    .filter(({ source }) => source.includes(obsoleteName))
    .map(({ path }) => relative(repositoryRoot, path));

  expect(offenders.sort()).toEqual([]);
});

test("request-bound feature flag providers are loaded lazily", async () => {
  const source = await Bun.file(
    `${repositoryRoot}/apps/deskohub-workspace/features/feature-flags/backend/workspace-feature-flag.service.ts`
  ).text();

  expect(source).not.toContain('import "server-only"');
  expect(source).not.toMatch(/from "\.\/(?:node|subject)"/);
});

test("the Dotypos adapter retains its process-wide token cache", async () => {
  const source = await Bun.file(
    `${repositoryRoot}/apps/deskohub-workspace/shared/backend/config/dotypos.config.ts`
  ).text();

  expect(source).toContain("Layer.buildWithMemoMap");
});
