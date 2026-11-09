import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileWorkspaceAppStyles } from "@/shared/testing/workspace-app-styles.test-utils";

/**
 * Builds the hydrated AccountShell harness for a real browser: its script,
 * which mounts into `#account-sections-test-root`, and the app styles it
 * renders with.
 */
export const buildAccountSectionsHarness = async (): Promise<{
  readonly script: string;
  readonly styles: string;
}> => {
  const directory = await mkdtemp(join(tmpdir(), "account-sections-browser-"));
  try {
    const build = await Bun.build({
      entrypoints: [
        join(import.meta.dir, "account-sections.browser-harness.tsx"),
      ],
      format: "iife",
      minify: true,
      naming: "account-sections-harness.js",
      outdir: directory,
      target: "browser",
    });
    if (!build.success) {
      throw new Error(build.logs.map(({ message }) => message).join("\n"));
    }
    return {
      script: await Bun.file(
        join(directory, "account-sections-harness.js")
      ).text(),
      styles: await compileWorkspaceAppStyles(),
    };
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
};
