import { resolve } from "node:path";

const appRoot = resolve(import.meta.dir, "..");
const entrypoint = resolve(appRoot, "scripts/workspace-e2e-allocation.ts");
const actionBundlePath = resolve(
  appRoot,
  "../../.github/actions/workspace-e2e-allocation/index.mjs"
);

// Bun labels each bundled module with a comment naming its source path. Under
// Bun's isolated installs that path runs through the package's store directory,
// node_modules/.bun/<name>@<version>+<peer hash>/node_modules/, and the peer
// hash changes whenever an unrelated workspace package changes the lockfile.
const moduleCommentStoreDirectory =
  /^(\/\/ .*?)node_modules\/\.bun\/[^/\n]+\/node_modules\//gm;

/** Drops Bun store directories from module comments so the committed bundle depends only on package versions. */
export const withoutInstallStorePaths = (bundle: string) =>
  bundle.replace(moduleCommentStoreDirectory, "$1node_modules/");

const buildAllocationAction = async () => {
  const result = await Bun.build({
    entrypoints: [entrypoint],
    format: "esm",
    root: appRoot,
    target: "node",
  });
  const [bundle] = result.outputs;
  if (!result.success || !bundle || result.outputs.length !== 1) {
    throw new AggregateError(
      result.logs,
      "Workspace E2E allocation action bundle failed"
    );
  }
  await Bun.write(
    actionBundlePath,
    withoutInstallStorePaths(await bundle.text())
  );
};

if (import.meta.main) {
  await buildAllocationAction();
}
