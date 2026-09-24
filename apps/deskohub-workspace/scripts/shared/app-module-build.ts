import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import postcss from "postcss";
import loadPostCssConfig from "postcss-load-config";

export const appModuleExtensions = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
] as const;

/**
 * Resolves a module base path to an existing source file, trying the bare
 * path, each supported extension, and each extension behind an `index`
 * file. `specifier` is only used in the error message.
 */
export const resolveModulePath = async (
  basePath: string,
  specifier: string = basePath
): Promise<string> => {
  const candidates = [
    basePath,
    ...appModuleExtensions.map((extension) => `${basePath}${extension}`),
    ...appModuleExtensions.map((extension) =>
      join(basePath, `index${extension}`)
    ),
  ];
  for (const candidate of candidates) {
    if (await isFile(candidate)) return candidate;
  }
  throw new Error(`Could not resolve module: ${specifier}`);
};

/**
 * Runs the app's PostCSS config over the workspace globals.css and returns
 * the bundler-ready virtual module for an `onLoad` callback.
 */
export const transformGlobalsCss = async (
  globalsCssPath: string,
  appRoot: string
): Promise<{ contents: string; loader: "css"; resolveDir: string }> => {
  const config = await loadPostCssConfig({}, appRoot);
  const source = await readFile(globalsCssPath, "utf8");
  const transformed = await postcss(config.plugins).process(source, {
    from: globalsCssPath,
  });
  return {
    contents: transformed.css,
    loader: "css",
    resolveDir: appRoot,
  };
};

const isFile = async (filePath: string): Promise<boolean> => {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
};
