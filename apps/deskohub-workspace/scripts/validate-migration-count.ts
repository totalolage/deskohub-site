import { fileURLToPath } from "node:url";
import { $ } from "bun";

const workspaceMigrationPathspec =
  "apps/deskohub-workspace/db/migrations/*.sql";

export const parseChangedMigrationPaths = (output: string) =>
  output
    .split("\n")
    .map((path) => path.trim())
    .filter(Boolean);

export const assertValidMigrationCount = (
  migrationPaths: ReadonlyArray<string>
) => {
  if (migrationPaths.length <= 1) return;

  throw new Error(
    `Workspace PRs may introduce at most one Drizzle SQL migration; found ${migrationPaths.length}.\n${migrationPaths.join("\n")}`
  );
};

const validateMigrationCount = async (baseSha: string) => {
  const git =
    await $`git diff --name-only ${`${baseSha}...HEAD`} -- ${workspaceMigrationPathspec}`
      .cwd(fileURLToPath(new URL("../../..", import.meta.url)))
      .quiet()
      .nothrow();
  process.stderr.write(git.stderr);

  if (git.exitCode !== 0) {
    throw new Error(
      `Unable to inspect Workspace migrations (git exit ${git.exitCode})`
    );
  }

  assertValidMigrationCount(parseChangedMigrationPaths(git.stdout.toString()));
};

if (import.meta.main) {
  const baseSha = process.argv[2];
  if (!baseSha) {
    process.stderr.write("Usage: validate-migration-count.ts <base-sha>\n");
    process.exit(1);
  }

  validateMigrationCount(baseSha).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exit(1);
  });
}
