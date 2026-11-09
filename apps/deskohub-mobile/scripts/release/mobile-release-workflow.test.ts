import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Pull request runs use the workflow file from the PR branch, so these
// conditions keep the release key out of dry runs by mistake, not against a
// PR that edits them. Against that, the keystore lives only in the
// mobile-release environment, whose mobile-v* tag policy GitHub matches
// against the run's ref, which no workflow edit changes.

type Step = {
  readonly env?: Readonly<Record<string, string>>;
  readonly id?: string;
  readonly if?: string;
  readonly name?: string;
  readonly run?: string;
  readonly uses?: string;
  readonly with?: Readonly<Record<string, unknown>>;
  readonly "working-directory"?: string;
};

type Job = {
  readonly env?: Readonly<Record<string, string>>;
  readonly environment?: unknown;
  readonly if?: string;
  readonly steps: readonly Step[];
};

type Workflow = {
  readonly env?: Readonly<Record<string, string>>;
  readonly jobs: Readonly<Record<string, Job>>;
  readonly on: Readonly<Record<string, unknown>>;
};

const workflow = Bun.YAML.parse(
  readFileSync(
    resolve(
      import.meta.dir,
      "../../../../.github/workflows/mobile-release.yml"
    ),
    "utf8"
  )
) as Workflow;

const releaseKeySecret = /\bsecrets\.ANDROID_KEYSTORE_\w+/;
const tagOnly = "github.event_name == 'push'";
const pullRequestOnly = "github.event_name == 'pull_request'";
// An empty environment name leaves pull request dry runs without one.
const releaseEnvironment = `\${{ ${tagOnly} && 'mobile-release' || '' }}`;
// Secrets kept only in the mobile-release environment. EXPO_TOKEN is not one:
// pull request dry runs read the repository's copy.
const environmentSecret =
  /\bsecrets\.(ANDROID_KEYSTORE_\w+|BLOB_READ_WRITE_TOKEN|MOBILE_UPDATES_PUBLISH_TOKEN)\b/;

const mentionsReleaseKey = (value: unknown) =>
  releaseKeySecret.test(JSON.stringify(value ?? null));

const build = workflow.jobs.build;
if (build === undefined) {
  throw new Error("mobile-release.yml has no build job.");
}

const stepNamed = (name: string): Step => {
  const step = build.steps.find((candidate) => candidate.name === name);
  if (step === undefined) {
    throw new Error(`The build job has no step named ${JSON.stringify(name)}.`);
  }
  return step;
};

const releaseBuild = stepNamed("Build and verify the release-signed APK");
const dryRunBuild = stepNamed("Build and verify the debug-signed dry-run APK");

describe("mobile-release.yml release key", () => {
  test("only release tags trigger push runs", () => {
    expect(workflow.on.push).toEqual({ tags: ["mobile-v*"] });
  });

  test("no workflow or job env exposes the release key", () => {
    expect(mentionsReleaseKey(workflow.env)).toBe(false);
    for (const job of Object.values(workflow.jobs)) {
      expect(mentionsReleaseKey(job.env)).toBe(false);
    }
  });

  test("only the build job reads the release key, from the mobile-release environment on tag pushes", () => {
    const jobs = Object.entries(workflow.jobs).filter(([, job]) =>
      mentionsReleaseKey(job)
    );
    expect(jobs.map(([name]) => name)).toEqual(["build"]);
    expect(build.environment).toBe(releaseEnvironment);
  });

  test("every other job that reads a mobile-release secret runs only on tag pushes, in that environment", () => {
    const jobs = Object.entries(workflow.jobs).filter(
      ([name, job]) =>
        name !== "build" && environmentSecret.test(JSON.stringify(job))
    );
    for (const [name, job] of jobs) {
      expect({ name, if: job.if, environment: job.environment }).toEqual({
        name,
        if: tagOnly,
        environment: "mobile-release",
      });
    }
  });

  test("every step that reads the release key runs only on tag pushes", () => {
    const steps = Object.values(workflow.jobs).flatMap((job) =>
      job.steps.filter(mentionsReleaseKey)
    );
    expect(steps.map((step) => step.name)).toEqual([releaseBuild.name]);
    for (const step of steps) {
      expect(step.if).toBe(tagOnly);
    }
  });

  test("the release build runs after the tagged commit is checked against main", () => {
    const mainCheck = stepNamed("Require the tagged commit on main");
    expect(mainCheck.if).toBe(tagOnly);
    expect(build.steps.indexOf(mainCheck)).toBeLessThan(
      build.steps.indexOf(releaseBuild)
    );
    expect(releaseBuild.run).not.toContain("--signing");
  });
});

describe("mobile-release.yml self-check", () => {
  test("runs these tests on every event before either build", () => {
    const selfCheck = stepNamed("Test the release scripts");
    expect(selfCheck.if).toBeUndefined();
    expect(selfCheck["working-directory"]).toBe("apps/deskohub-mobile");
    expect(selfCheck.run).toBe("bun test scripts/release");
    for (const buildStep of [releaseBuild, dryRunBuild]) {
      expect(build.steps.indexOf(selfCheck)).toBeLessThan(
        build.steps.indexOf(buildStep)
      );
    }
  });
});

describe("mobile-release.yml pull request dry run", () => {
  test("signs with a generated debug key and never sees the release key", () => {
    expect(dryRunBuild.if).toBe(pullRequestOnly);
    expect(dryRunBuild.run).toContain("--signing debug");
    expect(mentionsReleaseKey(dryRunBuild)).toBe(false);
  });

  test("builds the same app as the release build", () => {
    const {
      ANDROID_KEYSTORE_BASE64,
      ANDROID_KEYSTORE_PASSWORD,
      ...releaseEnv
    } = releaseBuild.env ?? {};
    expect(ANDROID_KEYSTORE_BASE64).toBeDefined();
    expect(ANDROID_KEYSTORE_PASSWORD).toBeDefined();
    expect(dryRunBuild.env).toEqual(releaseEnv);
    expect(dryRunBuild["working-directory"]).toBe(
      releaseBuild["working-directory"]
    );
  });

  test("uploads the APK as a workflow artifact", () => {
    const upload = build.steps.find((step) =>
      step.uses?.startsWith("actions/upload-artifact@")
    );
    expect(upload?.if).toBeUndefined();
    expect(upload?.with?.name).toBe("deskohub-mobile-apk");
  });
});

describe("mobile-release.yml Gradle cache", () => {
  const usesCache = (step: Step) =>
    step.uses?.startsWith("actions/cache") ?? false;
  const gradleHome = ["~/.gradle/caches", "~/.gradle/wrapper"];
  const cachePaths = (step: Step) =>
    String(step.with?.path ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");
  const keyStep = stepNamed("Resolve the Gradle cache key");
  const restore = stepNamed("Restore the Gradle cache");
  const check = stepNamed("Check the Gradle cache for signing material");
  const save = stepNamed("Save the Gradle cache");
  const unlessExactHit = `${pullRequestOnly} && steps.gradle-cache.outputs.cache-hit != 'true'`;

  test("only pull request dry runs restore or save a cache, so the release build never uses one", () => {
    for (const [name, job] of Object.entries(workflow.jobs)) {
      const cacheSteps = job.steps.filter(usesCache);
      expect({ name, steps: cacheSteps.map((step) => step.name) }).toEqual({
        name,
        steps: name === "build" ? [restore.name, save.name] : [],
      });
    }
    expect(keyStep.if).toBe(pullRequestOnly);
    expect(restore.if).toBe(pullRequestOnly);
    expect(check.if).toBe(unlessExactHit);
    expect(save.if).toBe(unlessExactHit);
  });

  test("caches only the Gradle downloads, never Gradle settings or the keystore", () => {
    expect(cachePaths(restore)).toEqual(gradleHome);
    expect(cachePaths(save)).toEqual(gradleHome);
    for (const step of [keyStep, restore, check, save]) {
      expect(JSON.stringify(step)).not.toContain("secrets.");
    }
  });

  test("restores before both builds and saves after a successful dry run, behind the signing-material check", () => {
    const index = (step: Step) => build.steps.indexOf(step);
    expect(index(keyStep)).toBeLessThan(index(restore));
    expect(index(restore)).toBeLessThan(index(releaseBuild));
    expect(index(restore)).toBeLessThan(index(dryRunBuild));
    expect(index(dryRunBuild)).toBeLessThan(index(check));
    expect(index(check)).toBeLessThan(index(save));
  });

  test("pre-fetches the Gradle distribution on every event, after a restore and before either build", () => {
    const prefetch = stepNamed("Pre-fetch the Gradle distribution");
    const index = (step: Step) => build.steps.indexOf(step);
    expect(prefetch.if).toBeUndefined();
    expect(prefetch["working-directory"]).toBe("apps/deskohub-mobile");
    expect(prefetch.run).toBe(
      "bun scripts/release/mobile-release.ts prepare-gradle"
    );
    expect(JSON.stringify(prefetch)).not.toContain("secrets.");
    expect(index(restore)).toBeLessThan(index(prefetch));
    expect(index(prefetch)).toBeLessThan(index(releaseBuild));
    expect(index(prefetch)).toBeLessThan(index(dryRunBuild));
  });

  test("keys on the Gradle distribution and native inputs, falls back to the closest earlier cache, and saves under the full key", () => {
    expect(keyStep.id).toBe("gradle-cache-key");
    expect(keyStep.run).toContain("mobile-release.ts gradle-cache-key");
    expect(restore.id).toBe("gradle-cache");
    const key = String(restore.with?.key);
    expect(key).toContain(`\${{ steps.gradle-cache-key.outputs.gradle }}`);
    expect(key).toContain(
      `\${{ steps.gradle-cache-key.outputs.native-inputs }}`
    );
    const restoreKeys = cachePaths({
      with: { path: restore.with?.["restore-keys"] },
    });
    expect(restoreKeys.length).toBeGreaterThan(0);
    for (const prefix of restoreKeys) {
      expect(key.startsWith(prefix)).toBe(true);
      expect(prefix).not.toBe(key);
    }
    expect(save.with?.key).toBe(
      `\${{ steps.gradle-cache.outputs.cache-primary-key }}`
    );
  });
});

describe("mobile-release.yml update publish", () => {
  test("resolves the app config with the production build profile's env", async () => {
    const eas = (await Bun.file(
      resolve(import.meta.dir, "../../eas.json")
    ).json()) as {
      build: { production: { env?: Record<string, string> } };
    };
    const productionEnv = eas.build.production.env ?? {};
    expect(productionEnv.MOBILE_UPDATES_CODE_SIGNING).toBe("required");
    expect(workflow.jobs["ota-update"]?.env).toMatchObject(productionEnv);
    for (const step of workflow.jobs["ota-update"]?.steps ?? []) {
      for (const name of Object.keys(productionEnv)) {
        expect(step.env?.[name]).toBeUndefined();
      }
    }
  });
});
