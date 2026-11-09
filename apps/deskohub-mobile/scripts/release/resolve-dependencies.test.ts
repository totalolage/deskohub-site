import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  gradleNetworkProperties,
  withGradleProperties,
} from "./gradle-wrapper";

// Runs resolve-dependencies.init.gradle with a real Gradle against a local
// Maven repository. mobile-gradle-cache.yml sets MOBILE_RELEASE_GRADLE to the
// distribution's bin/gradle before it saves a cache entry; without it (Mobile
// CI, the release job's self-check) these tests are skipped.
const gradle = process.env.MOBILE_RELEASE_GRADLE || undefined;
const initScript = join(import.meta.dir, "resolve-dependencies.init.gradle");

const pom = `<?xml version="1.0"?>
<project><modelVersion>4.0.0</modelVersion><groupId>com.example</groupId><artifactId>lib</artifactId><version>1.0</version></project>`;
// An empty zip is a valid jar.
const jar = new Uint8Array([80, 75, 5, 6, ...new Array<number>(18).fill(0)]);

// Answers 504 to the first `failures` requests for each file, then serves it.
const serveRepository = (failures: number) => {
  const requests = new Map<string, number>();
  const server = Bun.serve({
    fetch(request) {
      const path = new URL(request.url).pathname;
      const count = (requests.get(path) ?? 0) + 1;
      requests.set(path, count);
      if (count <= failures) {
        return new Response("Gateway Timeout", { status: 504 });
      }
      if (path === "/repo/com/example/lib/1.0/lib-1.0.pom") {
        return new Response(pom);
      }
      if (path === "/repo/com/example/lib/1.0/lib-1.0.jar") {
        return new Response(jar);
      }
      return new Response("Not Found", { status: 404 });
    },
    port: 0,
  });
  return {
    pomRequests: () => requests.get("/repo/com/example/lib/1.0/lib-1.0.pom"),
    server,
    url: `http://127.0.0.1:${server.port}/repo`,
  };
};

const directories: string[] = [];
const servers: { stop: (force?: boolean) => unknown }[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) {
    server.stop(true);
  }
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

const runResolve = async (input: {
  readonly build: string;
  readonly gradleProperties: string;
  readonly lib?: string;
}) => {
  const directory = mkdtempSync(join(tmpdir(), "resolve-dependencies-test-"));
  directories.push(directory);
  const home = join(directory, "home");
  const project = join(directory, "project");
  mkdirSync(home);
  mkdirSync(join(project, "lib"), { recursive: true });
  writeFileSync(join(home, "gradle.properties"), input.gradleProperties);
  writeFileSync(
    join(project, "settings.gradle"),
    `rootProject.name = "probe"\n${input.lib === undefined ? "" : 'include("lib")\n'}`
  );
  writeFileSync(join(project, "build.gradle"), input.build);
  if (input.lib !== undefined) {
    writeFileSync(join(project, "lib", "build.gradle"), input.lib);
  }
  const child = Bun.spawn(
    [
      gradle ?? "gradle",
      "--no-daemon",
      "--init-script",
      initScript,
      "--no-configuration-cache",
      "--continue",
      "resolveDependencies",
    ],
    {
      cwd: project,
      env: { ...process.env, GRADLE_USER_HOME: home },
      stderr: "pipe",
      stdout: "pipe",
    }
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, output: `${stdout}\n${stderr}` };
};

const dependingOn = (url: string) => `
repositories { maven { url = "${url}"; allowInsecureProtocol = true } }
configurations { probe { canBeResolved = true; canBeConsumed = false } }
dependencies { probe "com.example:lib:1.0" }
`;

// Short backoff keeps the retries fast; the attempt count is the one CI uses.
const fastRetries = withGradleProperties(
  "systemProp.org.gradle.internal.repository.initial.backoff=100\n",
  gradleNetworkProperties
);

describe.skipIf(gradle === undefined)(
  "resolve-dependencies.init.gradle",
  () => {
    test("fails when a download keeps failing, so no incomplete cache is saved", async () => {
      const repository = serveRepository(Number.POSITIVE_INFINITY);
      servers.push(repository.server);
      const result = await runResolve({
        build: dependingOn(repository.url),
        gradleProperties: fastRetries,
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Dependencies failed to resolve");
      expect(result.output).toContain(":probe:");
    }, 180_000);

    test("rides out five 504 answers with the CI retry properties", async () => {
      const repository = serveRepository(5);
      servers.push(repository.server);
      const result = await runResolve({
        build: dependingOn(repository.url),
        gradleProperties: fastRetries,
      });
      expect({
        exitCode: result.exitCode,
        output: result.exitCode === 0 ? "" : result.output,
      }).toEqual({ exitCode: 0, output: "" });
      expect(repository.pomRequests()).toBe(6);
    }, 180_000);

    test("skips a configuration no variant of its dependencies matches", async () => {
      const result = await runResolve({
        build: `
configurations {
  probe {
    canBeResolved = true
    canBeConsumed = false
    attributes { attribute(Usage.USAGE_ATTRIBUTE, objects.named(Usage, "probe-usage")) }
  }
}
dependencies { probe project(":lib") }
`,
        gradleProperties: "",
        lib: `
configurations {
  elements {
    canBeResolved = false
    canBeConsumed = true
    attributes { attribute(Usage.USAGE_ATTRIBUTE, objects.named(Usage, "other-usage")) }
  }
}
`,
      });
      expect({
        exitCode: result.exitCode,
        output: result.exitCode === 0 ? "" : result.output,
      }).toEqual({ exitCode: 0, output: "" });
      expect(result.output).toContain(
        "Skipped unmatched dependencies in 1 configurations of :"
      );
    }, 180_000);
  }
);
