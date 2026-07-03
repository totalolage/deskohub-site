import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const workspaceRoot = fileURLToPath(new URL("..", import.meta.url));
const dbPaths = ["db/schema", "db/migrations", "drizzle.config.ts"];

const skipMigrationExitCode = 78;

const runGit = (args: string[]) =>
  spawnSync("git", args, { cwd: workspaceRoot, stdio: "inherit" });

const writeLine = (message: string) => process.stdout.write(`${message}\n`);
const writeWarning = (message: string) => process.stderr.write(`${message}\n`);

if (process.env.VERCEL_ENV === "production") {
  writeLine("Running db:migrate for production build");
  process.exit(0);
}

const fetchMain = runGit([
  "fetch",
  "--depth=1",
  "origin",
  "main:refs/remotes/origin/main",
]);

if (fetchMain.status !== 0) {
  writeWarning("Could not fetch origin/main; running db:migrate");
  process.exit(0);
}

const diffMain = runGit(["diff", "--quiet", "origin/main", "--", ...dbPaths]);

if (diffMain.status === 0) {
  writeLine(
    `Skipping db:migrate for VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"}; no workspace DB schema diff from origin/main`
  );
  process.exit(skipMigrationExitCode);
}

if (diffMain.status === 1) {
  writeLine("Running db:migrate because workspace DB schema changed");
  process.exit(0);
}

writeWarning("Could not diff origin/main; running db:migrate");
process.exit(0);
