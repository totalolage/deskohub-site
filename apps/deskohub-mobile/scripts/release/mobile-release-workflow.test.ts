import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Pull request runs use the workflow file from the PR branch, so these
// conditions keep the release key out of dry runs by mistake, not against a
// PR that edits them. The secrets themselves stay readable by same-repository
// branches.

type Step = {
  readonly env?: Readonly<Record<string, string>>;
  readonly if?: string;
  readonly name?: string;
  readonly run?: string;
  readonly uses?: string;
  readonly with?: Readonly<Record<string, unknown>>;
  readonly "working-directory"?: string;
};

type Job = {
  readonly env?: Readonly<Record<string, string>>;
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
