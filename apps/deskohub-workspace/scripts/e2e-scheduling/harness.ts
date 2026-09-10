import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

const appDir = resolve(import.meta.dir, "../..");
const artifactDirectory = resolve(appDir, "e2e-artifacts", "scheduling");
const childTimeoutMs = 20_000;
const checkoutProjects = [
  "checkout-non-payment",
  "checkout-payment-1",
  "checkout-payment-2",
  "checkout-payment-3",
] as const;
const preparationProjects = [
  "checkout-availability",
  "checkout-provider-preparation",
  "checkout-invoice-persistence",
  "checkout-plan",
] as const;
const scenarios = [
  "baseline",
  "baseline-failure",
  "candidate",
  "candidate-account-failure",
  "candidate-checkout-failure",
] as const;
type Scenario = (typeof scenarios)[number];

type ImportedConfig = Awaited<
  typeof import("../../playwright.e2e.config")
>["default"];
type Graph = Omit<
  ImportedConfig,
  | "projects"
  | "workers"
  | "maxFailures"
  | "retries"
  | "fullyParallel"
  | "forbidOnly"
> & {
  projects: NonNullable<ImportedConfig["projects"]>;
  workers: NonNullable<ImportedConfig["workers"]>;
  maxFailures: NonNullable<ImportedConfig["maxFailures"]>;
  retries: NonNullable<ImportedConfig["retries"]>;
  fullyParallel: NonNullable<ImportedConfig["fullyParallel"]>;
  forbidOnly: NonNullable<ImportedConfig["forbidOnly"]>;
};
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
  step?: number;
  sharedStep?: number;
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
  sharedFixtureAdmitted: boolean,
  cleanupAdmitted: boolean,
  lateAdmissions: number,
];

async function loadGraph(): Promise<Graph> {
  const { default: graph } = await import("../../playwright.e2e.config");
  must(graph.projects, "actual config contains no projects");
  must(graph.workers !== undefined, "actual config contains no workers");
  must(
    graph.maxFailures !== undefined,
    "actual config contains no maxFailures"
  );
  must(graph.retries !== undefined, "actual config contains no retries");
  return {
    ...graph,
    projects: graph.projects,
    workers: graph.workers,
    maxFailures: graph.maxFailures,
    retries: graph.retries,
    fullyParallel: graph.fullyParallel ?? false,
    forbidOnly: graph.forbidOnly ?? false,
  };
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

function graphFor(graph: Graph, scenario: Scenario) {
  if (!scenario.startsWith("baseline")) {
    return graph;
  }
  return {
    ...graph,
    projects: graph.projects.map((project) =>
      projectName(project) === "account-auth"
        ? { ...project, dependencies: ["checkout-setup"] }
        : project
    ),
  };
}

function fakeSource(playwrightImport: string, projectName: string) {
  return `import { access, appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { test as base } from ${JSON.stringify(playwrightImport)};

const syntheticProject = ${JSON.stringify(projectName)};
const eventDirectory = process.env.WORKSPACE_E2E_SCHEDULING_EVENT_DIR;
const scenario = process.env.WORKSPACE_E2E_SCHEDULING_SCENARIO;
const failureMode = process.env.WORKSPACE_E2E_SCHEDULING_FAILURE_MODE;
const rendezvousTimeoutMs = 18_000;
const checkoutFirstSignals = [
  "checkout-non-payment-first-started",
  "checkout-payment-1-first-started",
  "checkout-payment-2-first-started",
  "checkout-payment-3-first-started",
];

if (!eventDirectory || !scenario) {
  throw new Error("Synthetic scheduler setup is missing");
}

await mkdir(eventDirectory, { recursive: true });
const signalDirectory = join(eventDirectory, "signals");
await mkdir(signalDirectory, { recursive: true });
let sequence = 0;
let sharedStep = 0;

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
const signalPath = (name) => join(signalDirectory, name + ".signal");
const signal = async (name) => {
  await appendFile(signalPath(name), "ready\\n");
};
const waitForSignals = async (names) => {
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
  project === "checkout-non-payment" || project.startsWith("checkout-payment-")
    ? 1000
    : project.startsWith("checkout-")
      ? 180
      : 40;
const testCount =
  syntheticProject === "account-auth"
    ? 9
    : syntheticProject.startsWith("checkout-payment-")
      ? 2
      : 1;

test.describe.configure({ mode: "serial" });
for (let step = 1; step <= testCount; step += 1) {
  test("synthetic-" + step, async ({}, info) => {
    await runSyntheticTest(info, "synthetic-" + step, async () => {
      if (syntheticProject !== "account-auth") {
        if (step === 1) {
          await signal(syntheticProject + "-first-started");
          if (
            failureMode === "candidate-account" &&
            syntheticProject.startsWith("checkout-") &&
            checkoutFirstSignals.includes(syntheticProject + "-first-started")
          ) {
            await waitForPlaywrightInterruption(info, "synthetic-1");
            return;
          }
          if (
            failureMode === "candidate-checkout" &&
            syntheticProject.startsWith("checkout-") &&
            syntheticProject !== "checkout-payment-1" &&
            checkoutFirstSignals.includes(syntheticProject + "-first-started")
          ) {
            await waitForPlaywrightInterruption(info, "synthetic-1");
            return;
          }
          if (
            failureMode === "candidate-checkout" &&
            syntheticProject === "checkout-payment-1"
          ) {
            await waitForSignals([
              "account-auth-first-started",
              ...checkoutFirstSignals,
            ]);
            await emit(info, "checkout-failure", { testName: "synthetic-1" });
            throw new Error("Synthetic checkout failure");
          }
        }
        await sleep(durationFor(syntheticProject));
        return;
      }

      sharedStep += 1;
      if (sharedStep !== step) {
        throw new Error("Account worker state was not serial");
      }
      await emit(info, "account-step-start", {
        sharedStep,
        step,
        testName: "synthetic-" + step,
      });
      if (step === 1) {
        await signal("account-auth-first-started");
        if (failureMode === "candidate-checkout") {
          await waitForPlaywrightInterruption(info, "synthetic-1");
          return;
        }
        if (failureMode === "candidate-account") {
          await waitForSignals(checkoutFirstSignals);
          await emit(info, "account-failure", { testName: "synthetic-1" });
          throw new Error("Synthetic account failure");
        }
        await sleep(120);
        await emit(info, "account-quiet-start", { testName: "synthetic-1" });
        await sleep(3000);
        await emit(info, "account-quiet-end", { testName: "synthetic-1" });
        if (failureMode === "baseline") {
          await emit(info, "account-failure", { testName: "synthetic-1" });
          throw new Error("Synthetic account failure");
        }
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

function unionDuration(spans: readonly Range[]) {
  const sorted = spans
    .filter((span) => span.end > span.start)
    .sort((left, right) => left.start - right.start);
  let total = 0;
  let currentEnd = 0;
  for (const span of sorted) {
    if (span.start >= currentEnd) {
      total += span.end - span.start;
    } else if (span.end > currentEnd) {
      total += span.end - currentEnd;
    }
    currentEnd = Math.max(currentEnd, span.end);
  }
  return total;
}

function summarize(
  events: readonly Event[],
  items: readonly Interval[],
  wallSpanMs: number
) {
  const quietStart = events.find(
    (event) => event.event === "account-quiet-start"
  )?.at;
  const quietEnd = events.find(
    (event) => event.event === "account-quiet-end"
  )?.at;
  const checkoutSpans =
    quietStart !== undefined && quietEnd !== undefined
      ? items
          .filter((item) =>
            checkoutProjects.some((project) => project === item.start.project)
          )
          .map((item) => ({
            start: Math.max(item.start.at, quietStart),
            end: Math.min(item.end.at, quietEnd),
          }))
      : [];
  const startedTests = events
    .filter((event) => event.event === "test-start")
    .map(testKey)
    .sort();
  const failureAt = events.find(
    (event) =>
      event.event === "account-failure" || event.event === "checkout-failure"
  )?.at;
  const allTimes = items.flatMap((item) => [item.start.at, item.end.at]);
  return {
    wallSpanMs,
    criticalPathMs: allTimes.length
      ? Math.max(...allTimes) - Math.min(...allTimes)
      : 0,
    accountQuietMs:
      quietStart !== undefined && quietEnd !== undefined
        ? quietEnd - quietStart
        : 0,
    checkoutOverlapMs: unionDuration(checkoutSpans),
    maxActiveTests: peakOverlap(items),
    maxPaymentTests: peakOverlap(items, (item) =>
      item.start.project.startsWith("checkout-payment-")
    ),
    fixtureFinalizedOwnershipCount: events.filter(
      (event) => event.event === "fixture-finalizer-complete"
    ).length,
    startedTests,
    failedTests: events
      .filter(
        (event) => event.event === "test-end" && event.outcome === "failed"
      )
      .map(testKey),
    sharedFixtureAdmitted: Boolean(range(items, "checkout-shared-fixture")),
    cleanupAdmitted: Boolean(range(items, "checkout-cleanup")),
    lateAdmissions:
      failureAt === undefined
        ? 0
        : events.filter(
            (event) => event.event === "test-start" && event.at > failureAt
          ).length,
  };
}

function failureModeFor(scenario: Scenario) {
  if (scenario === "baseline-failure") return "baseline";
  if (scenario === "candidate-account-failure") return "candidate-account";
  if (scenario === "candidate-checkout-failure") return "candidate-checkout";
  return "none";
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
        WORKSPACE_E2E_SCHEDULING_FAILURE_MODE: failureModeFor(scenario),
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
    run.summary.maxActiveTests <= 6 && run.summary.maxPaymentTests <= 3,
    `${run.scenario} exceeded worker or payment limits`
  );
}

function assertAccountLane(run: Run) {
  const steps = run.events
    .filter((event) => event.event === "account-step-start")
    .sort(
      (left, right) => left.at - right.at || left.sequence - right.sequence
    );
  must(steps.length === 9, `${run.scenario} did not run nine account tests`);
  must(
    new Set(steps.map((event) => event.workerIndex)).size === 1,
    `${run.scenario} account tests used multiple workers`
  );
  must(
    steps.every(
      (event, index) =>
        event.step === index + 1 && event.sharedStep === index + 1
    ),
    `${run.scenario} account tests were not serial`
  );
}

function assertPaymentLanes(run: Run) {
  for (const name of checkoutProjects.slice(1)) {
    const lane = run.intervals
      .filter((item) => item.start.project === name)
      .sort((left, right) => left.start.at - right.start.at);
    must(lane.length === 2, `${run.scenario} payment lane ${name} count`);
    const first = lane[0];
    const second = lane[1];
    must(first, `${run.scenario} payment lane ${name} first test`);
    must(second, `${run.scenario} payment lane ${name} second test`);
    must(
      second.start.at >= first.end.at,
      `${run.scenario} payment lane ${name} was not serial`
    );
  }
}

function assertSharedFixtureTail(run: Run) {
  const sharedFixture = requiredRange(
    run.intervals,
    "checkout-shared-fixture",
    run.scenario
  );
  for (const name of checkoutProjects) {
    must(
      requiredRange(run.intervals, name, run.scenario).end <
        sharedFixture.start,
      `${run.scenario} shared fixture started before ${name}`
    );
  }
}

function assertCleanupTail(run: Run, graph: Graph) {
  const cleanup = requiredRange(
    run.intervals,
    "checkout-cleanup",
    run.scenario
  );
  for (const project of graph.projects) {
    const name = projectName(project);
    if (name === "checkout-cleanup") continue;
    must(
      requiredRange(run.intervals, name, run.scenario).end < cleanup.start,
      `${run.scenario} cleanup started before ${name}`
    );
  }
}

function assertOnlyFirstTests(run: Run) {
  const projects = ["account-auth", ...checkoutProjects];
  for (const project of projects) {
    const later = run.summary.startedTests.filter((key) => {
      if (!key.startsWith(`${project}/synthetic-`)) return false;
      return key !== `${project}/synthetic-1`;
    });
    must(
      later.length === 0,
      `${run.scenario} admitted a later ${project} test`
    );
  }
}

function assertInterruptedFailure(run: Run) {
  const failureAt = requiredEventAt(
    run.events,
    ["account-failure", "checkout-failure"],
    run.scenario
  );
  must(
    run.summary.lateAdmissions === 0,
    `${run.scenario} admitted a later test`
  );
  must(
    !run.summary.sharedFixtureAdmitted,
    `${run.scenario} admitted shared fixture`
  );
  must(!run.summary.cleanupAdmitted, `${run.scenario} admitted cleanup`);
  assertOnlyFirstTests(run);
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
    run.summary.sharedFixtureAdmitted,
    run.summary.cleanupAdmitted,
    run.summary.lateAdmissions,
  ];
}

function verify(graph: Graph, runs: readonly Run[]) {
  const baseline = runFor(runs, "baseline");
  const baselineFailure = runFor(runs, "baseline-failure");
  const candidate = runFor(runs, "candidate");
  const candidateAccountFailure = runFor(runs, "candidate-account-failure");
  const candidateCheckoutFailure = runFor(runs, "candidate-checkout-failure");
  must(
    baseline.exitCode === 0 && candidate.exitCode === 0,
    "successful synthetic runs failed"
  );
  for (const run of [
    baselineFailure,
    candidateAccountFailure,
    candidateCheckoutFailure,
  ]) {
    must(run.exitCode !== 0, `${run.scenario} unexpectedly passed`);
  }
  for (const run of runs) assertRunCompletion(run);
  assertAccountLane(baseline);
  assertAccountLane(candidate);
  assertPaymentLanes(baseline);
  assertPaymentLanes(candidate);
  must(
    JSON.stringify(baseline.summary.startedTests) ===
      JSON.stringify(candidate.summary.startedTests),
    "baseline/candidate successful started test sets differ"
  );
  must(
    baseline.summary.checkoutOverlapMs === 0 &&
      candidate.summary.checkoutOverlapMs > 0,
    "before/after checkout overlap was not observed"
  );
  must(
    requiredRange(baseline.intervals, "account-auth", "baseline").end <
      requiredRange(baseline.intervals, "checkout-availability", "baseline")
        .start,
    "baseline account ordering changed"
  );
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
  assertSharedFixtureTail(baseline);
  assertSharedFixtureTail(candidate);
  assertCleanupTail(baseline, graph);
  assertCleanupTail(candidate, graph);
  assertInterruptedFailure(candidateAccountFailure);
  assertInterruptedFailure(candidateCheckoutFailure);
  const expectedFailFast: FailFast = [1, 1, false, false, 0];
  for (const run of [
    baselineFailure,
    candidateAccountFailure,
    candidateCheckoutFailure,
  ]) {
    must(
      JSON.stringify(failFast(run)) === JSON.stringify(expectedFailFast),
      `${run.scenario} fail-fast tuple changed`
    );
  }
}

export async function runWorkspaceE2ESchedulingRegression() {
  const graph = await loadGraph();
  must(
    graph.workers === 6 &&
      graph.maxFailures === 1 &&
      graph.retries === 0 &&
      graph.fullyParallel === true &&
      graph.forbidOnly === true,
    "actual Playwright controls drifted"
  );
  const account = graph.projects.find(
    (project) => project.name === "account-auth"
  );
  must(account, "actual config is missing account-auth");
  must(
    account.dependencies?.includes("checkout-plan"),
    "candidate account dependency is not checkout-plan"
  );
  const projectNames = graph.projects.map(projectName);
  for (const name of [
    ...checkoutProjects,
    ...preparationProjects,
    "checkout-shared-fixture",
    "checkout-cleanup",
  ]) {
    must(projectNames.includes(name), `actual config is missing ${name}`);
  }
  await mkdir(artifactDirectory, { recursive: true });
  const root = await mkdtemp(join(artifactDirectory, "run-"));
  const testsDirectory = join(root, "tests");
  await mkdir(testsDirectory, { recursive: true });
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
    runs.push(
      await runScenario(
        root,
        graphFor(graph, scenario),
        scenario,
        testsDirectory
      )
    );
  }
  const packageInfo = await Bun.file(
    Bun.resolveSync("@playwright/test/package.json", import.meta.dir)
  ).json();
  const version = String(packageInfo.version);
  const before = runFor(runs, "baseline").summary;
  const after = runFor(runs, "candidate").summary;
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
      candidateAccountDependencies: account.dependencies,
    },
    comparison: {
      before,
      after,
      delta: {
        wallSpanMs: after.wallSpanMs - before.wallSpanMs,
        criticalPathMs: after.criticalPathMs - before.criticalPathMs,
        checkoutOverlapMs: after.checkoutOverlapMs - before.checkoutOverlapMs,
      },
    },
    knownLimitations: [
      "Playwright 1.61.0 does not admit checkout-cleanup after maxFailures stops a failing run; failed baseline/candidate cleanup is intentionally not required.",
    ],
    scenarios: runs.map(({ intervals: _intervals, ...run }) => run),
  };
  await writeFile(artifactPath, `${JSON.stringify(report, null, 2)}\n`);
  verify(graph, runs);
  return artifactPath;
}
