import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createContext, runInContext } from "node:vm";
import {
  type CatalogText,
  classifyChunks,
  findTexts,
  readCatalogTexts,
  selectLeakEvidence,
} from "./administration-message-leaks.test-utils";

// Checks the client chunks of a production build, so it stays out of the
// default suite. Build, then select it by path:
//   bun turbo run build --filter=deskohub-workspace -- --experimental-build-mode=compile
//   bun --cwd apps/deskohub-workspace run test:build-output
// Turbopack renames modules and exports, so the check matches message text.

const appDirectory = path.resolve(import.meta.dir, "../../..");
const nextDirectory = path.join(appDirectory, ".next");
const administrationMessagesDirectory = path.join(import.meta.dir, "messages");
const customerMessagesDirectory = path.join(
  appDirectory,
  "features/i18n/messages"
);

type ClientReferenceManifest = {
  readonly clientModules?: Record<string, { readonly chunks: string[] }>;
  readonly entryJSFiles?: Record<string, string[]>;
};

const toChunkFile = (chunk: string) => chunk.replace(/^\/?_next\//, "");

const readRouteChunks = async () => {
  const appServerDirectory = path.join(nextDirectory, "server/app");
  const manifestFiles = (
    await readdir(appServerDirectory, { recursive: true })
  ).filter((file) => file.endsWith("_client-reference-manifest.js"));
  const routeChunks = new Map<string, Set<string>>();

  for (const file of manifestFiles) {
    const context = createContext({});
    runInContext(
      await readFile(path.join(appServerDirectory, file), "utf8"),
      context
    );
    const manifests: Record<string, ClientReferenceManifest> =
      context.__RSC_MANIFEST;
    for (const [entry, manifest] of Object.entries(manifests)) {
      const chunks = [
        ...Object.values(manifest.entryJSFiles ?? {}).flat(),
        ...Object.values(manifest.clientModules ?? {}).flatMap(
          ({ chunks }) => chunks
        ),
      ]
        .filter((chunk) => chunk.endsWith(".js"))
        .map(toChunkFile);
      routeChunks.set(entry.replace(/\/(?:page|route)$/, ""), new Set(chunks));
    }
  }

  return routeChunks;
};

const readRootChunks = async (): Promise<string[]> =>
  JSON.parse(
    await readFile(path.join(nextDirectory, "build-manifest.json"), "utf8")
  ).rootMainFiles.map(toChunkFile);

// Every emitted client script, including lazily loaded chunks no route
// manifest lists.
const readEmittedChunks = async () => {
  const files = (
    await readdir(path.join(nextDirectory, "static"), { recursive: true })
  ).filter((file) => file.endsWith(".js"));
  return new Map(
    await Promise.all(
      files.map(async (file) => {
        const chunk = path.posix.join("static", file.split(path.sep).join("/"));
        return [
          chunk,
          await readFile(path.join(nextDirectory, chunk), "utf8"),
        ] as const;
      })
    )
  );
};

const readCatalogDirectory = async (directory: string) => {
  const catalogs = (await readdir(directory, { recursive: true })).filter(
    (file) => file.endsWith(".json")
  );
  const texts: CatalogText[] = [];
  for (const file of catalogs) {
    texts.push(
      ...readCatalogTexts(
        path.basename(file, ".json"),
        await readFile(path.join(directory, file), "utf8")
      )
    );
  }
  return texts;
};

const isAdministrationRoute = (route: string) =>
  route === "/[locale]/admin" || route.startsWith("/[locale]/admin/");

const routeChunks = await readRouteChunks();
const rootChunks = await readRootChunks();
const chunks = await readEmittedChunks();
const customerCatalogTexts = await readCatalogDirectory(
  customerMessagesDirectory
);
const administrationTexts = selectLeakEvidence(
  await readCatalogDirectory(administrationMessagesDirectory),
  customerCatalogTexts
);
const customerTexts = selectLeakEvidence(customerCatalogTexts, []);

const customerRoutesByChunk = new Map<string, string[]>();
for (const chunk of rootChunks) customerRoutesByChunk.set(chunk, ["(root)"]);
for (const [route, routeChunkSet] of routeChunks) {
  if (isAdministrationRoute(route)) continue;
  for (const chunk of routeChunkSet) {
    customerRoutesByChunk.set(chunk, [
      ...(customerRoutesByChunk.get(chunk) ?? []),
      route,
    ]);
  }
}
const { administrationOnly, customerReachable } = classifyChunks({
  administrationEntryChunks: new Set(
    [...routeChunks]
      .filter(([route]) => isAdministrationRoute(route))
      .flatMap(([, routeChunkSet]) => [...routeChunkSet])
  ),
  chunks,
  customerEntryChunks: new Set(customerRoutesByChunk.keys()),
});

const describeChunk = (chunk: string) => {
  const routes = customerRoutesByChunk.get(chunk);
  return routes
    ? `loaded by ${routes.slice(0, 3).join(", ")}`
    : "not attributable to an administration route";
};

describe("administration messages in a production build", () => {
  test("finds administration and customer chunks in the build", () => {
    expect(
      [...customerRoutesByChunk.keys()].every((chunk) => chunks.has(chunk))
    ).toBe(true);
    expect(administrationOnly.size).toBeGreaterThan(0);
    expect(customerRoutesByChunk.size).toBeGreaterThan(rootChunks.length);
    expect(administrationTexts.length).toBeGreaterThan(0);
  });

  test("keeps administration message text out of every chunk a customer route can load", () => {
    const leaks: string[] = [];
    for (const chunk of customerReachable) {
      for (const { locale, text } of findTexts(
        administrationTexts,
        chunks.get(chunk) ?? ""
      )) {
        leaks.push(
          `${locale} ${JSON.stringify(text)} in ${chunk} (${describeChunk(chunk)})`
        );
      }
    }

    expect(leaks).toEqual([]);
  });

  // Without these the check above could pass on a build or matcher that sees
  // no message text at all.
  test("finds administration message text in administration chunks in each locale", () => {
    const found = new Set<string>();
    for (const chunk of administrationOnly) {
      for (const { locale } of findTexts(
        administrationTexts,
        chunks.get(chunk) ?? ""
      )) {
        found.add(locale);
      }
    }

    expect([...found].sort()).toEqual(["cs-CZ", "en-US"]);
  });

  test("finds customer message text in customer chunks", () => {
    expect(
      [...customerReachable].some(
        (chunk) => findTexts(customerTexts, chunks.get(chunk) ?? "").length > 0
      )
    ).toBe(true);
  });

  test("reports a parameterized administration message planted in a customer chunk", () => {
    const probeTexts = selectLeakEvidence(
      readCatalogTexts(
        "en-US",
        JSON.stringify({
          probe: "Showing {count} audit entries for operator {operator}",
        })
      ),
      customerCatalogTexts
    );
    const [rootChunk] = rootChunks;
    const source = chunks.get(rootChunk) ?? "";
    const planted = `${source};return\`Showing \${e?.count} audit entries for operator \${e?.operator}\``;

    expect(customerReachable.has(rootChunk)).toBe(true);
    expect(findTexts(probeTexts, source)).toEqual([]);
    expect(findTexts(probeTexts, planted).map(({ text }) => text)).toEqual([
      " audit entries for operator ",
    ]);
  });
});
