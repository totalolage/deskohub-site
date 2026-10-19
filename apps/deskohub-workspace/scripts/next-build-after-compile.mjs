/**
 * Next runs `compiler.runAfterProductionCompile`, which in production is
 * PostHog's source-map processing and upload, inside the compile process
 * while Turbopack is still writing its build cache. Together they left a cold
 * production compile no headroom on Vercel's 8 GB build machine. So
 * `scripts/next-build.ts` has its compile run skip the hook and runs the hook
 * itself, through this module, once that process exits. Generation skips the
 * hook, so the hook still runs once, before generation, as in one `next build`.
 */
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PHASE_PRODUCTION_BUILD } from "next/constants.js";

/** Set to `1` for a `next build` whose after-compile hook the runner runs. */
export const deferAfterCompileVariable = "WORKSPACE_NEXT_BUILD_DEFERS_AFTER_COMPILE";

/**
 * @typedef {import("next").NextConfig} NextConfig
 * @typedef {{ defaultConfig: NextConfig }} NextConfigContext
 * @typedef {NextConfig | ((phase: string, context: NextConfigContext) => NextConfig | Promise<NextConfig>)} NextConfigExport
 */

/**
 * @param {NextConfigExport} config
 * @param {string} phase
 * @param {NextConfigContext} context
 * @returns {Promise<NextConfig>}
 */
const resolveNextConfig = async (config, phase, context) =>
  typeof config === "function" ? await config(phase, context) : config;

/**
 * Wraps the exported Next config so that, while the runner defers it, the
 * config Next loads has no after-compile hook.
 *
 * @param {NextConfigExport} config
 * @returns {(phase: string, context: NextConfigContext) => Promise<NextConfig>}
 */
export const withDeferrableAfterCompile = (config) => async (phase, context) => {
  const resolved = await resolveNextConfig(config, phase, context);
  if (process.env[deferAfterCompileVariable] !== "1") return resolved;
  if (resolved.compiler?.runAfterProductionCompile === undefined) {
    return resolved;
  }
  const { runAfterProductionCompile: _deferred, ...compiler } =
    resolved.compiler;
  return { ...resolved, compiler };
};

/**
 * Runs the after-compile hook of the Next config in `projectDir` with the
 * metadata `next build` passes it.
 *
 * @param {string} projectDir
 */
export const runAfterCompile = async (projectDir) => {
  const { default: config } = await import(
    pathToFileURL(join(projectDir, "next.config.mjs")).href
  );
  // The Workspace exports a config object, which wrappers such as
  // withPostHogConfig only receive defaultConfig for; they never read it.
  const resolved = await resolveNextConfig(config, PHASE_PRODUCTION_BUILD, {
    defaultConfig: {},
  });
  await resolved.compiler?.runAfterProductionCompile?.({
    distDir: join(projectDir, resolved.distDir ?? ".next"),
    projectDir,
  });
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runAfterCompile(process.cwd());
}
