import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { z } from "zod";

const appDir = resolve(import.meta.dir, "../..");
const artifactDirectory = resolve(appDir, "e2e-artifacts", "scheduling");
const childTimeoutMs = 30_000;
const checkoutProjects = ["checkout-cases"] as const;
const preparationProjects = ["checkout-setup"] as const;
const accessCodeProject = "access-code-creation";
const scenarios = ["candidate", "candidate-checkout-failure"] as const;
type Scenario = (typeof scenarios)[number];

const projectSchema = z
  .object({
    dependencies: z.array(z.string()).optional(),
    name: z.string(),
    teardown: z.string().optional(),
    workers: z.number().optional(),
  })
  .strict();
const graphSchema = z
  .object({
    forbidOnly: z.boolean().default(false),
    fullyParallel: z.boolean().default(false),
    maxFailures: z.number(),
    projects: z.array(projectSchema),
    retries: z.number(),
    workers: z.number(),
  })
  .strict();
type Graph = z.infer<typeof graphSchema>;
type Project = Graph["projects"][number];
type Event = {
  at: number;
  event: string;
  project: string;
  scenario: string;
  sequence: number;
  workerIndex: number;
  testName?: string;
  outcome?: string;
};
type Interval = { start: Event; end: Event };
type Range = { start: number; end: number };
type Run = {
  scenario: Scenario;
  exitCode: number;
  events: readonly Event[];
  intervals: readonly Interval[];
  summary: ReturnType<typeof summarize>;
};
type FailFast = readonly [
  failedTests: number,
  failedTestsAdmitted: number,
  cleanupAdmitted: boolean,
  lateAdmissions: number,
];

async function loadGraph(): Promise<Graph> {
  const configUrl = pathToFileURL(
    resolve(appDir, "playwright.e2e.config.ts")
  ).href;
  const evaluator = `
const { default: config } = await import(${JSON.stringify(configUrl)});
const projects = config.projects?.map((project) => ({
  name: project.name,
  dependencies: project.dependencies,
  teardown: project.teardown,
  workers: project.workers,
}));
process.stdout.write(JSON.stringify({
  projects,
  workers: config.workers,
  maxFailures: config.maxFailures,
  retries: config.retries,
  fullyParallel: config.fullyParallel,
  forbidOnly: config.forbidOnly,
}));
`;
  const child = Bun.spawn([process.execPath, "-e", evaluator], {
    cwd: appDir,
    env: {
      HOME: process.env.HOME ?? "/tmp",
      NODE_ENV: "test",
      PATH: process.env.PATH ?? "",
    },
    stderr: "pipe",
    stdin: "ignore",
    stdout: "pipe",
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, childTimeoutMs);

  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    const capturedOutputLength = stdout.length + stderr.length;
    must(
      !timedOut,
      `actual config loader timed out after ${childTimeoutMs}ms after draining ${capturedOutputLength} output characters`
    );
    must(
      exitCode === 0,
      `actual config loader exited with ${exitCode} after draining ${capturedOutputLength} output characters`
    );

    let payload: unknown;
    try {
      payload = JSON.parse(stdout);
    } catch {
      throw new Error(
        `Workspace E2E scheduling discrepancy: actual config loader emitted invalid JSON after draining ${capturedOutputLength} output characters`
      );
    }
    const parsed = graphSchema.safeParse(payload);
    must(
      parsed.success,
      `actual config loader emitted an invalid scheduling JSON shape after draining ${capturedOutputLength} output characters`
    );
    return parsed.data;
  } finally {
    clearTimeout(timer);
  }
}

function must<T>(value: T, message: string): asserts value {
  if (!value) {
    throw new Error(`Workspace E2E scheduling discrepancy: ${message}`);
  }
}

function projectName(project: Project) {
  const name = project.name;
  must(name, "actual config contains an unnamed project");
  return name;
}

function fakeSource(playwrightImport: string, projectName: string) {
  return `import { access, appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { test as base } from ${JSON.stringify(playwrightImport)};

const syntheticProject = ${JSON.stringify(projectName)};
const eventDirectory = process.env.WORKSPACE_E2E_SCHEDULING_EVENT_DIR;
const scenario = process.env.WORKSPACE_E2E_SCHEDULING_SCENARIO;
// Stays below the Playwright test timeout so a stuck rendezvous reports itself.
const rendezvousTimeoutMs = 8_000;
const checkoutFirstSignals = ["checkout-cases-first-started"];
// Failures wait until every capped case worker is busy, so the whole first
// case batch is admitted before maxFailures stops the run.
const firstBatchSignals = [
  ...checkoutFirstSignals,
  "checkout-cases-2-started",
  "checkout-cases-3-started",
  "checkout-cases-4-started",
  "checkout-cases-5-started",
];
const checkoutFailure = scenario === "candidate-checkout-failure";

if (!eventDirectory || !scenario) {
  throw new Error("Synthetic scheduler setup is missing");
}

await mkdir(eventDirectory, { recursive: true });
const signalDirectory = join(eventDirectory, "signals");
await mkdir(signalDirectory, { recursive: true });
let sequence = 0;

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
const signalPath = (name) => join(signalDirectory, name + ".signal");
const signal = async (name) => {
  await appendFile(signalPath(name), "ready\\n");
};
const waitForSignals = async (info, testName, names) => {
  const deadline = Date.now() + rendezvousTimeoutMs;
  while (Date.now() < deadline) {
    const present = await Promise.all(
      names.map(async (name) => {
        try {
          await access(signalPath(name));
          return true;
        } catch {
          return false;
        }
      })
    );
    if (present.every(Boolean)) return;
    await sleep(10);
  }
  await emit(info, "rendezvous-timeout", { testName });
  throw new Error("Synthetic scheduler rendezvous timed out");
};
const emit = async (info, event, details = {}) => {
  const record = {
    ...details,
    at: Date.now(),
    event,
    project: info.project.name,
    scenario,
    sequence: sequence++,
    workerIndex: info.workerIndex,
  };
  await appendFile(
    join(eventDirectory, "worker-" + info.workerIndex + ".jsonl"),
    JSON.stringify(record) + "\\n"
  );
};
const waitForPlaywrightInterruption = async (info, testName) => {
  await sleep(rendezvousTimeoutMs);
  await emit(info, "pending-body-timeout", { testName });
  throw new Error("Playwright did not interrupt the pending test body");
};

const test = base.extend({
  ownedResource: [
    async ({}, use, info) => {
      const testName = info.title;
      await emit(info, "resource-acquired", { testName });
      await emit(info, "journal-created", { testName });
      try {
        await use({ testName });
      } finally {
        await emit(info, "fixture-finalizer-complete", { testName });
        await emit(info, "journal-finalized", { testName });
      }
    },
    { auto: true },
  ],
});
const runSyntheticTest = async (info, testName, body) => {
  await emit(info, "test-start", { testName });
  try {
    await body();
    await emit(info, "test-end", { outcome: "passed", testName });
  } catch (error) {
    await emit(info, "test-end", { outcome: "failed", testName });
    throw error;
  }
};
const durationFor = (project) =>
  project === "checkout-cases"
    ? 250
    : project.startsWith("checkout-")
      ? 180
      : 40;
// Cases are independent and outnumber the workers, like the deployed suite,
// so they would queue the account lane without a worker cap.
const parallelCases = syntheticProject === "checkout-cases";
const testCount =
  syntheticProject === "account-auth" ? 9 : parallelCases ? 8 : 1;

test.describe.configure({ mode: parallelCases ? "parallel" : "serial" });
for (let step = 1; step <= testCount; step += 1) {
  test("synthetic-" + step, async ({}, info) => {
    const testName = "synthetic-" + step;
    await runSyntheticTest(info, testName, async () => {
      if (syntheticProject !== "account-auth") {
        if (step === 1) {
          await signal(syntheticProject + "-first-started");
        }
        if (parallelCases && step > 1) {
          await signal(syntheticProject + "-" + step + "-started");
        }
        const caseProject = checkoutFirstSignals.includes(
          syntheticProject + "-first-started"
        );
        if (caseProject && (step === 1 || parallelCases)) {
          if (checkoutFailure && step === 1) {
            await waitForSignals(info, testName, [
              "account-auth-first-started",
              ...firstBatchSignals,
            ]);
            await emit(info, "checkout-failure", { testName });
            throw new Error("Synthetic checkout failure");
          }
          if (checkoutFailure) {
            await waitForPlaywrightInterruption(info, testName);
            return;
          }
          // The first case batch cannot finish until the account lane starts,
          // so queueing the account lane behind the cases times out instead
          // of depending on worker start-up timing.
          await waitForSignals(info, testName, ["account-auth-first-started"]);
        }
        await sleep(durationFor(syntheticProject));
        return;
      }

      if (step === 1) {
        await signal("account-auth-first-started");
        if (checkoutFailure) {
          await waitForPlaywrightInterruption(info, testName);
          return;
        }
        await sleep(120);
        await emit(info, "account-quiet-start", { testName });
        await sleep(750);
        await emit(info, "account-quiet-end", { testName });
      } else {
        await sleep(40);
      }
    });
  });
}
`;
}

const testKey = (event: Event) => `${event.project}/${event.testName ?? ""}`;

async function readEvents(directory: string) {
  const files = (await readdir(directory)).filter((file) =>
    file.endsWith(".jsonl")
  );
  const events = (
    await Promise.all(
      files.map((file) => readFile(join(directory, file), "utf8"))
    )
  ).flatMap((content) =>
    content
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Event)
  );
  return events.sort(
    (left, right) =>
      left.at - right.at ||
      left.workerIndex - right.workerIndex ||
      left.sequence - right.sequence
  );
}

function intervals(events: readonly Event[]) {
  const starts = new Map<string, Event>();
  const result: Interval[] = [];
  for (const event of events) {
    const key = testKey(event);
    if (event.event === "test-start") {
      starts.set(key, event);
    }
    if (event.event === "fixture-finalizer-complete") {
      const start = starts.get(key);
      must(start, `fixture ${key} ended without a start event`);
      result.push({ end: event, start });
    }
  }
  return result;
}

function range(items: readonly Interval[], project: string): Range | undefined {
  const selected = items.filter((item) => item.start.project === project);
  if (selected.length === 0) return undefined;
  return {
    start: Math.min(...selected.map((item) => item.start.at)),
    end: Math.max(...selected.map((item) => item.end.at)),
  };
}

function requiredRange(
  items: readonly Interval[],
  project: string,
  context: string
) {
  const value = range(items, project);
  must(value, `${context} is missing ${project}`);
  return value;
}

function requiredEventAt(
  events: readonly Event[],
  names: readonly string[],
  context: string
) {
  const event = events.find((candidate) => names.includes(candidate.event));
  must(event, `${context} is missing ${names.join(" or ")}`);
  return event.at;
}

function peakOverlap(
  items: readonly Interval[],
  predicate: (item: Interval) => boolean = () => true
) {
  const points = items
    .filter(predicate)
    .flatMap(({ start, end }) => [
      { at: start.at, delta: 1, order: 1 },
      { at: end.at, delta: -1, order: 0 },
    ])
    .sort((left, right) => left.at - right.at || left.order - right.order);
  let active = 0;
  let maximum = 0;
  for (const point of points) {
    active += point.delta;
    maximum = Math.max(maximum, active);
  }
  return maximum;
}

function summarize(
  events: readonly Event[],
  items: readonly Interval[],
  wallSpanMs: number
) {
  const startedTests = events
    .filter((event) => event.event === "test-start")
    .map(testKey)
    .sort();
  const failureAt = events.find(
    (event) => event.event === "checkout-failure"
  )?.at;
  return {
    wallSpanMs,
    maxActiveTests: peakOverlap(items),
    fixtureFinalizedOwnershipCount: events.filter(
      (event) => event.event === "fixture-finalizer-complete"
    ).length,
    startedTests,
    failedTests: events
      .filter(
        (event) => event.event === "test-end" && event.outcome === "failed"
      )
      .map(testKey),
    cleanupAdmitted: Boolean(range(items, "checkout-cleanup")),
    lateAdmissions:
      failureAt === undefined
        ? 0
        : events.filter(
            (event) => event.event === "test-start" && event.at > failureAt
          ).length,
  };
}

async function runScenario(
  root: string,
  graph: Graph,
  scenario: Scenario,
  testsDirectory: string
): Promise<Run> {
  const directory = join(root, scenario);
  const eventsDirectory = join(directory, "events");
  await mkdir(eventsDirectory, { recursive: true });
  const config = {
    forbidOnly: graph.forbidOnly,
    fullyParallel: graph.fullyParallel,
    maxFailures: graph.maxFailures,
    outputDir: join(directory, "output"),
    projects: graph.projects.map((project) => {
      const name = projectName(project);
      return {
        dependencies: project.dependencies ?? [],
        name,
        teardown: project.teardown,
        testDir: testsDirectory,
        testMatch: [`${name}.mjs`],
        workers: project.workers,
      };
    }),
    retries: graph.retries,
    testDir: testsDirectory,
    timeout: 10_000,
    workers: graph.workers,
  };
  const configFile = join(directory, "playwright.config.mjs");
  await writeFile(configFile, `export default ${JSON.stringify(config)};\n`);
  const startedAt = performance.now();
  const child = Bun.spawn(
    [
      "node",
      Bun.resolveSync("@playwright/test/cli.js", import.meta.dir),
      "test",
      "--config",
      configFile,
    ],
    {
      cwd: appDir,
      env: {
        HOME: process.env.HOME ?? "/tmp",
        LANG: "C",
        NODE_ENV: "test",
        PATH: process.env.PATH ?? "",
        WORKSPACE_E2E_SCHEDULING_EVENT_DIR: eventsDirectory,
        WORKSPACE_E2E_SCHEDULING_SCENARIO: scenario,
      },
      stderr: "ignore",
      stdin: "ignore",
      stdout: "ignore",
    }
  );
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, childTimeoutMs);
  const exitCode = await child.exited;
  clearTimeout(timer);
  must(
    !timedOut,
    `${scenario} child timeout; fixture finalizers could not be proven`
  );
  const wallSpanMs = Math.round(performance.now() - startedAt);
  const events = await readEvents(eventsDirectory);
  const itemIntervals = intervals(events);
  return {
    scenario,
    exitCode,
    events,
    intervals: itemIntervals,
    summary: summarize(events, itemIntervals, wallSpanMs),
  };
}

function runFor(runs: readonly Run[], scenario: Scenario) {
  const run = runs.find((candidate) => candidate.scenario === scenario);
  must(run, `run ${scenario} is missing`);
  return run;
}

function assertRunCompletion(run: Run) {
  const started = run.summary.startedTests;
  const owned = run.events
    .filter((event) => event.event === "resource-acquired")
    .map(testKey)
    .sort();
  const journalCreated = run.events
    .filter((event) => event.event === "journal-created")
    .map(testKey)
    .sort();
  const journalFinalized = run.events
    .filter((event) => event.event === "journal-finalized")
    .map(testKey)
    .sort();
  const fixtureFinalized = run.events
    .filter((event) => event.event === "fixture-finalizer-complete")
    .map(testKey)
    .sort();
  must(
    started.every((key) => owned.includes(key)),
    `${run.scenario} started a test without owned resource`
  );
  must(
    JSON.stringify(owned) === JSON.stringify(journalCreated) &&
      JSON.stringify(owned) === JSON.stringify(journalFinalized) &&
      JSON.stringify(owned) === JSON.stringify(fixtureFinalized),
    `${run.scenario} fixture finalizer escalation`
  );
  must(
    !run.events.some((event) => event.event === "pending-body-timeout"),
    `${run.scenario} did not interrupt a pending test body`
  );
  must(
    run.summary.maxActiveTests <= 6,
    `${run.scenario} exceeded the worker limit`
  );
}

function assertOnlyFirstBatch(run: Run, graph: Graph) {
  for (const project of ["account-auth", ...checkoutProjects]) {
    const workers =
      graph.projects.find((candidate) => candidate.name === project)?.workers ??
      1;
    const started = run.summary.startedTests.filter((key) =>
      key.startsWith(`${project}/synthetic-`)
    );
    must(
      started.includes(`${project}/synthetic-1`) && started.length <= workers,
      `${run.scenario} admitted a later ${project} test`
    );
  }
}

function assertInterruptedFailure(run: Run, graph: Graph) {
  const failureAt = requiredEventAt(
    run.events,
    ["checkout-failure"],
    run.scenario
  );
  must(
    run.summary.lateAdmissions === 0,
    `${run.scenario} admitted a later test`
  );
  must(!run.summary.cleanupAdmitted, `${run.scenario} admitted cleanup`);
  must(
    !range(run.intervals, accessCodeProject),
    `${run.scenario} admitted the access-code case`
  );
  assertOnlyFirstBatch(run, graph);
  for (const project of ["account-auth", ...checkoutProjects]) {
    const interval = requiredRange(run.intervals, project, run.scenario);
    must(
      interval.start <= failureAt && interval.end >= failureAt,
      `${run.scenario} ${project} was not active at failure`
    );
  }
}

function failFast(run: Run): FailFast {
  const failedTests = run.summary.failedTests;
  return [
    failedTests.length,
    failedTests.filter((test) => run.summary.startedTests.includes(test))
      .length,
    run.summary.cleanupAdmitted,
    run.summary.lateAdmissions,
  ];
}

function verify(graph: Graph, runs: readonly Run[]) {
  const candidate = runFor(runs, "candidate");
  const checkoutFailure = runFor(runs, "candidate-checkout-failure");
  must(
    !candidate.events.some((event) => event.event === "rendezvous-timeout"),
    "candidate account-auth did not start in the first case batch"
  );
  must(candidate.exitCode === 0, "successful synthetic run failed");
  must(
    checkoutFailure.exitCode !== 0,
    `${checkoutFailure.scenario} unexpectedly passed`
  );
  for (const run of runs) assertRunCompletion(run);
  const candidateAccount = requiredRange(
    candidate.intervals,
    "account-auth",
    "candidate"
  );
  for (const name of preparationProjects) {
    must(
      requiredRange(candidate.intervals, name, "candidate").end <
        candidateAccount.start,
      `candidate ${name} started after account`
    );
  }
  // The access-code case shares the case phase but is queued last, so it
  // only takes a worker that frees up after the first case batch started.
  must(
    requiredRange(candidate.intervals, accessCodeProject, "candidate").start >
      candidateAccount.start,
    "candidate access-code case took a first case-batch worker"
  );
  const firstCaseEnd = Math.min(
    ...candidate.intervals
      .filter((item) =>
        checkoutProjects.some((project) => project === item.start.project)
      )
      .map((item) => item.end.at)
  );
  must(
    candidateAccount.start < firstCaseEnd,
    "candidate account-auth did not start in the first case batch"
  );
  const quietStart = requiredEventAt(
    candidate.events,
    ["account-quiet-start"],
    "candidate"
  );
  const quietEnd = requiredEventAt(
    candidate.events,
    ["account-quiet-end"],
    "candidate"
  );
  for (const name of checkoutProjects) {
    must(
      candidate.intervals.some(
        (item) =>
          item.start.project === name &&
          item.start.at < quietEnd &&
          item.end.at > quietStart
      ),
      `candidate ${name} missed account quiet overlap`
    );
  }
  assertInterruptedFailure(checkoutFailure, graph);
  const expectedFailFast: FailFast = [1, 1, false, 0];
  must(
    JSON.stringify(failFast(checkoutFailure)) ===
      JSON.stringify(expectedFailFast),
    `${checkoutFailure.scenario} fail-fast tuple changed`
  );
}

export async function runWorkspaceE2ESchedulingRegression() {
  const graph = await loadGraph();
  await mkdir(artifactDirectory, { recursive: true });
  const root = await mkdtemp(join(artifactDirectory, "run-"));
  const testsDirectory = join(root, "tests");
  await mkdir(testsDirectory, { recursive: true });
  const projectNames = graph.projects.map(projectName);
  const playwrightImport = pathToFileURL(
    Bun.resolveSync("@playwright/test", import.meta.dir)
  ).href;
  for (const name of projectNames) {
    await writeFile(
      join(testsDirectory, `${name}.mjs`),
      fakeSource(playwrightImport, name)
    );
  }
  const runs: Run[] = [];
  for (const scenario of scenarios) {
    runs.push(await runScenario(root, graph, scenario, testsDirectory));
  }
  const packageInfo = await Bun.file(
    Bun.resolveSync("@playwright/test/package.json", import.meta.dir)
  ).json();
  const version = String(packageInfo.version);
  const artifactPath = join(root, "scheduling-diagnostic.json");
  const report = {
    artifactPath,
    synthetic: true,
    deployed: false,
    playwrightVersion: version,
    effects: {
      browser: false,
      database: false,
      network: false,
      provider: false,
    },
    timingNote:
      "wallSpanMs is local elapsed time for synthetic Playwright runs; no deployment or database convergence is claimed.",
    graph: {
      workers: graph.workers,
      maxFailures: graph.maxFailures,
      retries: graph.retries,
      fullyParallel: graph.fullyParallel,
      forbidOnly: graph.forbidOnly,
      projectCount: graph.projects.length,
      accountDependencies: graph.projects.find(
        (project) => project.name === "account-auth"
      )?.dependencies,
    },
    knownLimitations: [
      "Playwright 1.61.0 does not admit checkout-cleanup after maxFailures stops a failing run; cleanup after the failing run is intentionally not required.",
    ],
    scenarios: runs.map(({ intervals: _intervals, ...run }) => run),
  };
  await writeFile(artifactPath, `${JSON.stringify(report, null, 2)}\n`);
  verify(graph, runs);
  return artifactPath;
}
