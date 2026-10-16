import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createContext, runInContext } from "node:vm";
import { Schema } from "effect";

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

// A catalog maps each key to a pattern, or to variants of a matched message.
const decodeCatalog = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Record(
      Schema.String,
      Schema.Union([
        Schema.String,
        Schema.Array(
          Schema.Struct({ match: Schema.Record(Schema.String, Schema.String) })
        ),
      ])
    )
  )
);

// Texts with placeholders compile into fragments, so only plain texts count.
const isPlainText = (pattern: string) => !/[{}]/.test(pattern);

const readCatalogTexts = async (directory: string) => {
  const catalogs = (await readdir(directory, { recursive: true })).filter(
    (file) => file.endsWith(".json")
  );
  const texts: { readonly locale: string; readonly text: string }[] = [];
  for (const file of catalogs) {
    const catalog = decodeCatalog(
      await readFile(path.join(directory, file), "utf8")
    );
    const locale = path.basename(file, ".json");
    for (const message of Object.values(catalog)) {
      const patterns = Array.isArray(message)
        ? message.flatMap(({ match }) => Object.values(match))
        : [message];
      for (const text of patterns.filter(isPlainText)) {
        texts.push({ locale, text });
      }
    }
  }
  return texts;
};

// A short single word ("Codes") can be a coincidental literal in customer
// code; any multi-word or longer text can't.
const isDistinctive = (text: string) =>
  /\S\s+\S/.test(text) || text.length >= 12;

const stringLiterals = (text: string) => [
  JSON.stringify(text),
  `'${text.replaceAll("'", "\\'")}'`,
  `\`${text}\``,
];

const findTexts = <T extends { readonly text: string }>(
  texts: readonly T[],
  source: string
) =>
  texts.filter(({ text }) =>
    stringLiterals(text).some((literal) => source.includes(literal))
  );

const isAdministrationRoute = (route: string) =>
  route === "/[locale]/admin" || route.startsWith("/[locale]/admin/");

const routeChunks = await readRouteChunks();
const rootChunks = await readRootChunks();
const customerTextSet = new Set(
  (await readCatalogTexts(customerMessagesDirectory)).map(({ text }) => text)
);
// Copy shared with the customer catalog may appear anywhere.
const administrationTexts = (
  await readCatalogTexts(administrationMessagesDirectory)
).filter(({ text }) => isDistinctive(text) && !customerTextSet.has(text));
const customerTexts = [...customerTextSet]
  .filter(isDistinctive)
  .map((text) => ({ text }));

const customerRoutesByChunk = new Map<string, string[]>();
for (const chunk of rootChunks) customerRoutesByChunk.set(chunk, ["(root)"]);
for (const [route, chunks] of routeChunks) {
  if (isAdministrationRoute(route)) continue;
  for (const chunk of chunks) {
    customerRoutesByChunk.set(chunk, [
      ...(customerRoutesByChunk.get(chunk) ?? []),
      route,
    ]);
  }
}
const administrationChunks = new Set(
  [...routeChunks]
    .filter(([route]) => isAdministrationRoute(route))
    .flatMap(([, chunks]) => [...chunks])
);
const readChunk = (chunk: string) =>
  readFile(path.join(nextDirectory, chunk), "utf8");

describe("administration messages in a production build", () => {
  test("finds administration and customer routes in the build", () => {
    expect(administrationChunks.size).toBeGreaterThan(0);
    expect(customerRoutesByChunk.size).toBeGreaterThan(rootChunks.length);
    expect(administrationTexts.length).toBeGreaterThan(0);
  });

  test("keeps administration message text out of every customer route chunk", async () => {
    const leaks: string[] = [];
    for (const [chunk, routes] of customerRoutesByChunk) {
      for (const { locale, text } of findTexts(
        administrationTexts,
        await readChunk(chunk)
      )) {
        leaks.push(
          `${locale} ${JSON.stringify(text)} in ${chunk} (loaded by ${routes.slice(0, 3).join(", ")})`
        );
      }
    }

    expect(leaks).toEqual([]);
  });

  // Without these the check above could pass on a build or matcher that sees
  // no message text at all.
  test("finds administration message text in administration chunks in each locale", async () => {
    const found = new Set<string>();
    for (const chunk of administrationChunks) {
      for (const { locale } of findTexts(
        administrationTexts,
        await readChunk(chunk)
      )) {
        found.add(locale);
      }
    }

    expect([...found].sort()).toEqual(["cs-CZ", "en-US"]);
  });

  test("finds customer message text in customer chunks", async () => {
    let found = 0;
    for (const chunk of customerRoutesByChunk.keys()) {
      found += findTexts(customerTexts, await readChunk(chunk)).length;
    }

    expect(found).toBeGreaterThan(0);
  });
});
