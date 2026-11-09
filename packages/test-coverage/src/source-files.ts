import { existsSync } from "node:fs";
import { join } from "node:path";

const sourceRoots = ["apps", "packages", "scripts"];
const sourceExtension = /\.[cm]?[jt]sx?$/;
const testFile = /\.(?:test|spec|pw)\.[cm]?[jt]sx?$/;
const declarationFile = /\.d\.[cm]?ts$/;

/**
 * Whether a repository-relative path is authored source a coverage report
 * covers: code, not tests, type declarations, or the coverage tooling itself.
 */
export function isCoverageSource(relativePath: string): boolean {
  return (
    sourceRoots.some((root) => relativePath.startsWith(`${root}/`)) &&
    sourceExtension.test(relativePath) &&
    !testFile.test(relativePath) &&
    !declarationFile.test(relativePath) &&
    !relativePath.startsWith("packages/test-coverage/")
  );
}

/**
 * Absolute paths of the repository's coverage sources: tracked files and
 * untracked files Git does not ignore, so generated code stays out.
 */
export async function listCoverageSources(
  repositoryRoot: string
): Promise<string[]> {
  const git = Bun.spawn(
    [
      "git",
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      ...sourceRoots,
    ],
    { cwd: repositoryRoot, stdout: "pipe", stderr: "inherit" }
  );
  const [output, exitCode] = await Promise.all([
    new Response(git.stdout).text(),
    git.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`git ls-files exited with ${exitCode}`);
  }
  return [...new Set(output.split("\0"))]
    .filter(isCoverageSource)
    .map((relativePath) => join(repositoryRoot, relativePath))
    .filter((path) => existsSync(path))
    .sort();
}
