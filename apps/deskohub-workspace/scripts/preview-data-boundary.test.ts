import { expect, test } from "bun:test";
import { resolve } from "node:path";

const readRepositoryFile = (relativePath: string) =>
  Bun.file(resolve(import.meta.dir, "../../../", relativePath)).text();

const normalized = (text: string) => text.replace(/\s+/g, " ");

const exceptionPhrase =
  "Better Auth login email, pending-verification email, and short-lived rate-limit IP keys";
const syntheticFixturePhrase = "Preview fixtures";
const noWorkaroundPhrase = /sanitizer|scrubber/i;

test("repository guidance records the approved preview data exception", async () => {
  const agents = normalized(await readRepositoryFile("AGENTS.md"));
  expect(agents).toContain(exceptionPhrase);
  expect(agents).toContain("use synthetic data only");
  expect(agents).toContain(
    "do not add a sanitizer or an alternate branch procedure"
  );
});

test("workspace operations guidance states the same boundary", async () => {
  const operations = normalized(
    await readRepositoryFile(
      ".agents/skills/deskohub-workspace-operations/references/database-and-releases.md"
    )
  );
  expect(operations).toContain(exceptionPhrase);
  expect(operations).toContain(
    `${syntheticFixturePhrase} and all Dotypos profile`
  );
  expect(operations).toContain("reservation data remain synthetic");
  expect(operations).toMatch(noWorkaroundPhrase);
});

test("workspace e2e guidance states the boundary and keeps fixtures synthetic", async () => {
  const e2e = normalized(
    await readRepositoryFile(
      ".agents/skills/deskohub-workspace-e2e/references/preview-workflow.md"
    )
  );
  expect(e2e).toContain(exceptionPhrase);
  expect(e2e).toContain("Everything else stays synthetic");
  expect(e2e).toContain("all Dotypos profile and reservation data, must be");
  expect(e2e).toMatch(noWorkaroundPhrase);
  expect(e2e).toContain("Every preview fixture");
});

test("account guidance states the boundary without weakening synthetic data rules", async () => {
  const account = normalized(
    await readRepositoryFile(
      ".agents/skills/deskohub-workspace-account/SKILL.md"
    )
  );
  expect(account).toContain(exceptionPhrase);
  expect(account).toContain("Preview fixtures and all Dotypos profile and");
  expect(account).toContain("reservation data stay synthetic");
  expect(account).toContain("no sanitizer and no alternate branch procedure");
  expect(account).toContain("Use synthetic recipients");
});
