import { readFile } from "node:fs/promises";
import { dirname, extname, relative, sep } from "node:path";

const transpilers: Readonly<Record<string, Bun.Transpiler>> = {
  ".ts": new Bun.Transpiler({ loader: "ts" }),
  ".tsx": new Bun.Transpiler({ loader: "tsx" }),
  ".js": new Bun.Transpiler({ loader: "js" }),
  ".mjs": new Bun.Transpiler({ loader: "js" }),
};

const isPathSpecifier = (specifier: string) =>
  specifier.startsWith(".") || specifier.startsWith("/");

/**
 * The file `specifier` loads from `importer`, or undefined for a package that
 * isn't installed where the importer can see it.
 */
const resolveImport = (
  specifier: string,
  importer: string
): string | undefined => {
  try {
    return Bun.resolveSync(specifier, dirname(importer));
  } catch (error) {
    if (isPathSpecifier(specifier)) throw error;
    return undefined;
  }
};

/** Repository source, workspace packages included, rather than an install. */
const isSourceModule = (file: string) =>
  !file.split(sep).includes("node_modules");

export type RuntimeImportGraph = {
  /** Source modules the entry loads, itself included, relative to the root. */
  readonly modules: readonly string[];
  /** Installed package specifiers those modules import, not followed. */
  readonly packages: readonly string[];
};

/**
 * Every module that loading `entry`, or each of several entries, loads at
 * runtime. Imports that resolve to repository source, workspace packages
 * included, are followed; installed packages are listed. Type-only imports
 * drop out when the source is transpiled, so they never count. A module
 * whose source `isReference` matches, such as a Server Action module a client
 * bundle calls by reference, is neither loaded nor followed.
 */
export const runtimeImportGraph = async (
  entry: string | readonly string[],
  root: string,
  {
    isReference = () => false,
  }: { readonly isReference?: (sourceText: string) => boolean } = {}
): Promise<RuntimeImportGraph> => {
  const visited = new Set<string>();
  const modules = new Set<string>();
  const packages = new Set<string>();
  const pending = [entry].flat();

  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    if (visited.has(file)) continue;
    visited.add(file);

    const transpiler = transpilers[extname(file)];
    if (transpiler === undefined) {
      modules.add(file);
      continue;
    }

    const sourceText = await readFile(file, "utf8");
    if (isReference(sourceText)) continue;
    modules.add(file);

    const { imports } = transpiler.scan(sourceText);
    for (const { path: specifier } of imports) {
      const resolved = resolveImport(specifier, file);
      if (resolved !== undefined && isSourceModule(resolved)) {
        pending.push(resolved);
      } else {
        packages.add(specifier);
      }
    }
  }

  return {
    modules: [...modules].map((file) => relative(root, file)).sort(),
    packages: [...packages].sort(),
  };
};
