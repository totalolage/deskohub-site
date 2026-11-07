import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  abandonedContainers,
  databaseUrl,
  publishedPort,
  shardJobDatabase,
  shardTasks,
  turboCommand,
  turboEnvironment,
} from "./local-test-shards";
import { parseWorkflow } from "./shared/workflow-contract";
import { testShardCount } from "./test-shard";

const workflow = parseWorkflow(
  resolve(import.meta.dir, "../../../.github/workflows/workspace-tests.yml")
);
const shardJob = workflow.jobs["test-functional-shards"];
const testStep = shardJob?.steps?.find(
  (step) => step.name === "Run Workspace tests"
);

describe("local test shards", () => {
  test("starts each shard's database from the image and credentials CI uses", () => {
    const database = shardJobDatabase(workflow);
    expect(database.image).toBe(shardJob?.services?.postgres?.image ?? "");
    // The local URL reaches the same database and role as the CI one.
    expect(databaseUrl(database, 5432)).toBe(
      shardJob?.env?.WORKSPACE_TEST_DATABASE_URL ?? ""
    );
    expect(() => shardJobDatabase({ jobs: {} })).toThrow(
      "no longer declares a postgres service"
    );
  });

  test("runs the same Turbo tasks and package filter as the CI shard jobs", () => {
    expect(shardTasks).toEqual(
      Array.from(
        { length: testShardCount },
        (_, index) => `test:shard-${index + 1}`
      )
    );
    const ciCommand = (testStep?.run ?? "")
      .replaceAll("$" + "{{ matrix.shard }}", "1")
      .split(/\s+/)
      .filter(Boolean);
    const localCommand = turboCommand(["--dry=json"]);
    // Neither launcher lets Bun load untracked .env files into Turbo.
    const launch = ["bun", "--no-env-file", "turbo", "run"];
    expect(ciCommand.slice(0, launch.length)).toEqual(launch);
    expect(localCommand.slice(0, launch.length)).toEqual(launch);
    const ciFilter = ciCommand.filter((word) => word.startsWith("--filter="));
    expect(ciFilter).toEqual(
      localCommand.filter((word) => word.startsWith("--filter="))
    );
    expect(ciCommand).toContain("test:shard-1");
    for (const task of shardTasks) {
      expect(localCommand.filter((word) => word === task)).toEqual([task]);
    }
    // Every shard finishes, like the matrix without fail-fast.
    expect(localCommand).toContain("--continue");
    expect(localCommand.at(-1)).toBe("--dry=json");
  });

  test("hashes the same CI and TZ values as the CI shard jobs and drops unhashed configuration", () => {
    const environment = turboEnvironment(
      {
        BUN_OPTIONS: "--preload ./coverage.ts",
        DATABASE_URL: "postgresql://runtime",
        DOTYPOS_API_URL: "https://dotypos.example",
        HOME: "/home/synthetic",
        PATH: "/usr/bin",
        TMPDIR: "/var/tmp/synthetic",
        TURBO_TEAM: "synthetic-team",
        TZ: "Europe/Prague",
      },
      ["postgresql://one", "postgresql://two"]
    );
    expect(environment).toEqual({
      CI: "true",
      HOME: "/home/synthetic",
      PATH: "/usr/bin",
      TMPDIR: "/var/tmp/synthetic",
      TURBO_TEAM: "synthetic-team",
      TZ: "UTC",
      WORKSPACE_TEST_DATABASE_URL_SHARD_1: "postgresql://one",
      WORKSPACE_TEST_DATABASE_URL_SHARD_2: "postgresql://two",
    });
    // GitHub Actions sets CI=true itself; the job sets TZ.
    expect(shardJob?.env?.TZ).toBe(environment.TZ);
    expect(shardJob?.env?.CI).toBeUndefined();
  });

  test("removes only containers whose runner is gone", () => {
    const running = new Set([101]);
    expect(
      abandonedContainers("aaa 101\nbbb 202\nccc \n\n", (pid) =>
        running.has(pid)
      )
    ).toEqual(["bbb", "ccc"]);
  });

  test("reads the dynamic loopback port Docker published", () => {
    expect(publishedPort("127.0.0.1:49153\n")).toBe(49153);
    for (const output of ["", "0.0.0.0:5432\n", "[::1]:49153\n"]) {
      expect(() => publishedPort(output)).toThrow("Expected a 127.0.0.1 port");
    }
  });
});
