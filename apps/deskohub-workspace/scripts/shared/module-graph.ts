import { readFile } from "node:fs/promises";
import { dirname, extname, relative } from "node:path";

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

const isAppModule = (file: string, root: string) => {
  const appRelative = relative(root, file);
  return !appRelative.startsWith("..") && !appRelative.includes("node_modules");
};

export type RuntimeImportGraph = {
  /** App modules the entry loads, itself included, relative to the root. */
  readonly modules: readonly string[];
  /** Package specifiers those modules import. Packages are not followed. */
  readonly packages: readonly string[];
};

/**
 * Every module that loading `entry` loads at runtime, following imports that
 * resolve inside `root` and outside `node_modules`. Type-only imports drop out
 * when the source is transpiled, so they never count.
 */
export const runtimeImportGraph = async (
  entry: string,
  root: string
): Promise<RuntimeImportGraph> => {
  const modules = new Set<string>();
  const packages = new Set<string>();
  const pending = [entry];

  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    if (modules.has(file)) continue;
    modules.add(file);

    const transpiler = transpilers[extname(file)];
    if (transpiler === undefined) continue;

    const { imports } = transpiler.scan(await readFile(file, "utf8"));
    for (const { path: specifier } of imports) {
      const resolved = resolveImport(specifier, file);
      if (resolved !== undefined && isAppModule(resolved, root)) {
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
