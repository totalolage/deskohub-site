import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// mobile-gradle-cache.yml writes the main-branch Gradle cache entry that
// mobile-release.yml's pull request dry runs restore, so both must name the
// entry the same way.

type Step = {
  readonly id?: string;
  readonly if?: string;
  readonly name?: string;
  readonly run?: string;
  readonly uses?: string;
  readonly with?: Readonly<Record<string, unknown>>;
};

type Workflow = {
  readonly jobs: Readonly<
    Record<string, { readonly if?: string; readonly steps: readonly Step[] }>
  >;
  readonly on: Readonly<Record<string, unknown>>;
};

const readWorkflow = (name: string) =>
  Bun.YAML.parse(
    readFileSync(
      resolve(import.meta.dir, "../../../../.github/workflows", name),
      "utf8"
    )
  ) as Workflow;

const warmup = readWorkflow("mobile-gradle-cache.yml");
const release = readWorkflow("mobile-release.yml");

const stepNamed = (steps: readonly Step[], name: string): Step => {
  const step = steps.find((candidate) => candidate.name === name);
  if (step === undefined) {
    throw new Error(`No step named ${JSON.stringify(name)}.`);
  }
  return step;
};

const warm = warmup.jobs.warm;
const build = release.jobs.build;
if (warm === undefined || build === undefined) {
  throw new Error("Missing the warm or build job.");
}
const warmStep = (name: string) => stepNamed(warm.steps, name);
const notExactHit = "steps.gradle-cache.outputs.cache-hit != 'true'";

describe("mobile-gradle-cache.yml", () => {
  test("writes the entry under mobile-release.yml's key, restore-keys and paths", () => {
    const pick = (step: Step) => ({
      key: step.with?.key,
      path: step.with?.path,
      "restore-keys": step.with?.["restore-keys"],
      uses: step.uses,
    });
    expect(pick(warmStep("Restore the Gradle cache"))).toEqual(
      pick(stepNamed(build.steps, "Restore the Gradle cache"))
    );
    expect(warmStep("Save the Gradle cache").with).toEqual(
      stepNamed(build.steps, "Save the Gradle cache").with
    );
    expect(warmStep("Resolve the Gradle cache key").run).toBe(
      stepNamed(build.steps, "Resolve the Gradle cache key").run
    );
  });

  test("only main saves, so pull requests that change the warm-up check it without writing an entry", () => {
    expect(warm.if).toBeUndefined();
    expect(warmup.on.push).toEqual({
      branches: ["main"],
      paths: expect.arrayContaining(["apps/deskohub-mobile/**", "bun.lock"]),
    });
    expect(warmStep("Restore the Gradle cache").if).toBe(
      "github.event_name != 'pull_request'"
    );
    expect(warmStep("Save the Gradle cache").if).toBe(
      `github.ref == 'refs/heads/main' && ${notExactHit}`
    );
  });

  test("downloads the dependencies without building, behind the Gradle test and the signing-material check", () => {
    const steps = [
      "Pre-fetch the Gradle distribution",
      "Download the Gradle dependencies",
      "Test the dependency download against a failing repository",
      "Check the Gradle cache for signing material",
      "Save the Gradle cache",
    ].map(warmStep);
    expect(steps.map((step) => warm.steps.indexOf(step))).toEqual(
      steps.map((step) => warm.steps.indexOf(step)).toSorted((a, b) => a - b)
    );
    expect(warmStep("Download the Gradle dependencies").run).toBe(
      "bun scripts/release/mobile-release.ts resolve-gradle-dependencies"
    );
    const gradleTest = warmStep(
      "Test the dependency download against a failing repository"
    );
    expect(gradleTest.if).toBe(notExactHit);
    expect(gradleTest.run).toContain(
      'MOBILE_RELEASE_GRADLE="$gradle" bun test scripts/release/resolve-dependencies.test.ts'
    );
    expect(JSON.stringify(warmup)).not.toContain("secrets.");
    expect(JSON.stringify(warmup)).not.toContain("eas-cli");
  });
});
