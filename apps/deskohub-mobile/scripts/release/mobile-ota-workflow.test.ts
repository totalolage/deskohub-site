import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type Step = {
  readonly env?: Readonly<Record<string, string>>;
  readonly name?: string;
  readonly run?: string;
  readonly uses?: string;
  readonly "working-directory"?: string;
};

type Job = {
  readonly env?: Readonly<Record<string, string>>;
  readonly environment?: unknown;
  readonly if?: string;
  readonly steps: readonly Step[];
};

type PushTrigger = {
  readonly branches?: readonly string[];
  readonly paths?: readonly string[];
};

type Workflow = {
  readonly env?: Readonly<Record<string, string>>;
  readonly jobs: Readonly<Record<string, Job>>;
  readonly on: {
    readonly push?: PushTrigger;
    readonly pull_request?: unknown;
    readonly workflow_dispatch?: unknown;
  };
};

const readWorkflow = (name: string) =>
  Bun.YAML.parse(
    readFileSync(
      resolve(import.meta.dir, "../../../../.github/workflows", name),
      "utf8"
    )
  ) as Workflow;

const ota = readWorkflow("mobile-ota.yml");
const release = readWorkflow("mobile-release.yml");
const publishJob = ota.jobs.publish;
if (publishJob === undefined) {
  throw new Error("mobile-ota.yml has no publish job.");
}

describe("mobile-ota.yml security and isolation", () => {
  test("never runs on pull requests and only deploys from main in the mobile-ota environment", () => {
    expect(ota.on.pull_request).toBeUndefined();
    expect(ota.on.push?.branches).toEqual(["main"]);
    expect(Object.keys(ota.jobs)).toEqual(["publish"]);
    expect(publishJob.if).toBe("github.ref == 'refs/heads/main'");
    expect(publishJob.environment).toBe("mobile-ota");
  });

  test("never references the Android release keystore or the mobile-release environment", () => {
    const serialized = JSON.stringify(ota);
    expect(serialized).not.toMatch(/ANDROID_KEYSTORE_/);
    expect(serialized).not.toContain("mobile-release");
  });
});

describe("mobile-ota.yml path scoping", () => {
  const paths = ota.on.push?.paths ?? [];

  test("triggers on mobile runtime inputs and excludes docs, tests, and website-only paths", () => {
    expect(paths).toContain(".github/workflows/mobile-ota.yml");
    expect(paths).toContain("apps/deskohub-mobile/app/**");
    expect(paths).toContain("apps/deskohub-mobile/src/**");
    expect(paths).toContain("apps/deskohub-mobile/assets/**");
    expect(paths).toContain("apps/deskohub-mobile/messages/**");
    expect(paths).toContain("!**/*.md");
    expect(paths).toContain("!**/*.test.*");
    expect(paths).toContain("!**/*.spec.*");
    expect(paths).toContain("!**/testing/**");

    for (const pattern of paths) {
      expect(pattern).not.toStartWith("apps/deskohub-workspace/");
      expect(pattern).not.toStartWith("apps/deskohub-boardgame-bar/");
      expect(pattern).not.toStartWith("apps/dhw/");
      expect(pattern).not.toStartWith(".agents/");
      expect(pattern).not.toStartWith("docs/");
      expect(pattern).not.toBe("apps/deskohub-mobile/**");
      expect(pattern).not.toBe("bun.lock");
    }
  });

  test("covers every workspace package that apps/deskohub-mobile depends on", async () => {
    const manifest = (await Bun.file(
      resolve(import.meta.dir, "../../package.json")
    ).json()) as {
      dependencies?: Record<string, string>;
    };
    const workspaceDeps = Object.entries(manifest.dependencies ?? {})
      .filter(([, version]) => version.startsWith("workspace:"))
      .map(([name]) => name.replace(/^@deskohub\//, ""));

    expect(workspaceDeps.length).toBeGreaterThan(0);
    for (const pkg of workspaceDeps) {
      expect(paths).toContain(`packages/${pkg}/src/**`);
      expect(paths).toContain(`packages/${pkg}/package.json`);
    }
  });
});

describe("mobile-ota.yml publish parity", () => {
  test("resolves the app config with eas.json's production env and matches mobile-release.yml's publish step", async () => {
    const eas = (await Bun.file(
      resolve(import.meta.dir, "../../eas.json")
    ).json()) as {
      build: { production: { env?: Record<string, string> } };
    };
    const productionEnv = eas.build.production.env ?? {};
    expect(productionEnv.MOBILE_UPDATES_CODE_SIGNING).toBe("required");
    expect(publishJob.env).toMatchObject(productionEnv);

    const indexOf = (matches: (step: Step) => boolean) => {
      const index = publishJob.steps.findIndex(matches);
      expect(index).toBeGreaterThanOrEqual(0);
      return index;
    };
    const install = indexOf(
      (step) => step.run === "bun install --frozen-lockfile"
    );
    const generate = indexOf(
      (step) =>
        step["working-directory"] === "apps/deskohub-mobile" &&
        step.run === "bun run eas-build-post-install"
    );
    const publish = indexOf(
      (step) => step.name === "Publish the over-the-air update"
    );
    expect(install).toBeLessThan(generate);
    expect(generate).toBeLessThan(publish);

    const releasePublishStep = release.jobs["ota-update"]?.steps.find(
      (step) => step.name === "Publish the over-the-air update"
    );
    expect(publishJob.steps[publish]).toEqual(releasePublishStep);
  });
});
