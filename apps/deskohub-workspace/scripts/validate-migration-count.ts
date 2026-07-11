import { fileURLToPath } from "node:url";

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
  const git = Bun.spawn(
    [
      "git",
      "diff",
      "--name-only",
      `${baseSha}...HEAD`,
      "--",
      workspaceMigrationPathspec,
    ],
    {
      cwd: fileURLToPath(new URL("../../..", import.meta.url)),
      stdout: "pipe",
      stderr: "inherit",
    }
  );

  const output = await new Response(git.stdout).text();
  const exitCode = await git.exited;
  if (exitCode !== 0) {
    throw new Error(
      `Unable to inspect Workspace migrations (git exit ${exitCode})`
    );
  }

  assertValidMigrationCount(parseChangedMigrationPaths(output));
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
