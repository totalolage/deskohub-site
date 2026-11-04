import { expect, test } from "bun:test";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dir, "../..");

/** Packages Turborepo lists for a filter, from the repository's package graph. */
const packagesMatching = (filter: string) => {
  const result = Bun.spawnSync(
    ["bun", "turbo", "ls", `--filter=${filter}`, "--output=json"],
    { cwd: repositoryRoot }
  );
  if (result.exitCode !== 0) {
    throw new Error(`turbo ls failed: ${result.stderr.toString()}`);
  }
  const output: { packages: { items: { name: string }[] } } = JSON.parse(
    result.stdout.toString()
  );
  return output.packages.items.map(({ name }) => name);
};

// Vercel skips a project when a commit changes no package in its dependency
// graph. Agent skills are a workspace package so that changes to them deploy
// Workspace previews, whose E2E checks need them, but not the portal.
test("agent skill changes deploy the Workspace app and not the portal", () => {
  const dependents = packagesMatching("...@deskohub/agent-skills");

  expect(dependents).toContain("deskohub-workspace");
  expect(dependents).not.toContain("deskohub-portal");
});
