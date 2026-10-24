import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testEmailAddress } from "@deskohub/test-email";
import {
  AdministrationCampaignDetail,
  AutomationDetail,
  AutomationDryRun,
  AutomationRunDetail,
  AutomationRunStats,
  AutomationRunSummary,
  AutomationVersionSummary,
  CalendarPreview,
  CliAccessToken,
  CliMutationRejected,
  CliSessionId,
} from "@deskohub/workspace-admin-api";
import { BunServices } from "@effect/platform-bun";
import {
  Console,
  Effect,
  Fiber,
  Layer,
  Option,
  Redacted,
  Schema,
} from "effect";
import { TestClock } from "effect/testing";
import { Command } from "effect/unstable/cli";
import { WorkspaceAdminApiClient } from "../api/workspace-admin-api-client.service";
import { AuthenticationService } from "../authentication/authentication.service";
import { dhwCommand } from "../command";
import { DhwConfig } from "../config/dhw-config.service";

const accessToken = Schema.decodeUnknownSync(CliAccessToken)("a".repeat(43));
const session = {
  id: Schema.decodeUnknownSync(CliSessionId)(
    "01980000-0000-7000-8000-000000000000"
  ),
  approvedBy: null,
  approvedByEmail: null,
  clientName: "test client",
  cliVersion: "1.24.0",
  buildTarget: "development" as const,
  createdAt: "2026-10-19T10:00:00.000Z",
  lastUsedAt: "2026-10-19T10:00:00.000Z",
  expiresAt: null,
};
const timestamp = "2026-10-19T10:00:00.000Z";
const campaignId = "campaign-1";
const previewId = "preview-1";

const halfHourly = { minutes: [0, 30] };
const hourly = { minutes: [0] };

const flowFor = (calendar: object) => ({
  trigger: { _tag: "Schedule", calendar },
  steps: [{ _tag: "Send", id: "send" }],
});

const frequencyFor = (calendar: { readonly minutes: ReadonlyArray<number> }) =>
  // The server computes this; the fixtures mirror its answer.
  ({
    maxFiresPerHour: calendar.minutes.length,
    firesMoreThanHourly: calendar.minutes.length > 1,
  });

const automationFor = (
  calendar: { readonly minutes: ReadonlyArray<number> },
  activation: object = { _tag: "PreviewRequired" }
) =>
  Schema.decodeUnknownSync(AutomationDetail)({
    campaignId,
    status: "draft",
    flow: flowFor(calendar),
    trigger: { kind: "schedule", frequency: frequencyFor(calendar) },
    activeVersion: null,
    versionCount: 0,
    pendingChanges: true,
    activation,
    acceptingSince: null,
    pausedAt: null,
    archivedAt: null,
    nextFireAt: null,
    updatedAt: timestamp,
  });

const dryRunFor = (
  calendar: { readonly minutes: ReadonlyArray<number> },
  status: "running" | "completed",
  page: object = {}
) =>
  Schema.decodeUnknownSync(AutomationDryRun)({
    previewId,
    campaignId,
    draftHash: "hash-1",
    kind: "schedule",
    status,
    asOf: timestamp,
    unitsDone: status === "completed" ? 2 : 1,
    unitsTotal: 2,
    errorCode: null,
    createdAt: timestamp,
    completedAt: status === "completed" ? timestamp : null,
    nextFires: [timestamp],
    frequency: frequencyFor(calendar),
    counts: {
      "would-send": 2,
      "condition-failed": 0,
      "not-in-audience": 0,
      "already-active": 0,
      withdrawn: 0,
      unavailable: 0,
    },
    eventsTotal: null,
    truncated: false,
    rows: [
      {
        triggerAt: timestamp,
        customerId: "customer-1",
        customerEventId: null,
        outcome: "would-send",
        stepId: "send",
        sendAt: timestamp,
        projected: false,
      },
    ],
    nextCursor: null,
    customers: [{ customerId: "customer-1", name: "Ada", email: null }],
    profileFactsAreCurrent: false,
    emails: [],
    ...page,
  });

const version = Schema.decodeUnknownSync(AutomationVersionSummary)({
  campaignId,
  versionNumber: 1,
  trigger: { kind: "schedule", frequency: frequencyFor(hourly) },
  draftHash: "hash-1",
  activatedAt: timestamp,
  audienceId: null,
  activatedByEmail: null,
  active: true,
});

const run = Schema.decodeUnknownSync(AutomationRunDetail)({
  runId: "run-1",
  campaignId,
  versionNumber: 1,
  customerId: "customer-1",
  triggerKind: "schedule",
  triggerAt: timestamp,
  state: "ended",
  phase: null,
  stepId: "send",
  dueAt: null,
  outcome: "sent",
  outcomeReason: null,
  sendId: null,
  startedAt: timestamp,
  endedAt: timestamp,
  timeline: [
    {
      sequence: 0,
      stepId: null,
      at: timestamp,
      kind: "started",
      detail: {},
    },
    {
      sequence: 1,
      stepId: "send",
      at: timestamp,
      kind: "skipped",
      detail: { reason: "no-consent" },
    },
  ],
});

const campaign = Schema.decodeUnknownSync(AdministrationCampaignDetail)({
  id: campaignId,
  title: "Welcome series",
  purpose: "operational",
  templateKey: "workspace",
  delivery: "automated",
  status: "draft",
  audienceId: null,
  locales: ["en-US"],
  createdAt: timestamp,
  updatedAt: timestamp,
  content: {
    "en-US": { subject: "Welcome", preheader: "", bodyMarkdown: "Hello" },
  },
});

type AutomationApi = Pick<
  WorkspaceAdminApiClient["Service"],
  | "getAutomation"
  | "updateAutomationFlow"
  | "dryRunAutomation"
  | "getAutomationDryRun"
  | "activateAutomation"
  | "pauseAutomation"
  | "listAutomationVersions"
  | "getAutomationRun"
  | "listAutomationRuns"
  | "getAutomationRunStats"
  | "previewCalendarExpression"
  | "createCampaign"
>;

const makeAutomationLayer = (overrides: Partial<AutomationApi> = {}) => {
  const calls: Array<readonly [string, ...ReadonlyArray<unknown>]> = [];
  const output: string[] = [];
  const errors: string[] = [];
  const record =
    <Args extends ReadonlyArray<unknown>, A>(
      name: string,
      result: (...args: Args) => A
    ) =>
    (_accessToken: unknown, ...args: Args) =>
      Effect.sync(() => {
        calls.push([name, ...args]);
        return result(...args);
      });
  const fake: AutomationApi = {
    getAutomation: record("getAutomation", () => automationFor(halfHourly)),
    updateAutomationFlow: record("updateAutomationFlow", () =>
      automationFor(halfHourly)
    ),
    dryRunAutomation: record("dryRunAutomation", () =>
      dryRunFor(halfHourly, "running")
    ),
    getAutomationDryRun: record("getAutomationDryRun", () =>
      dryRunFor(halfHourly, "completed")
    ),
    activateAutomation: record("activateAutomation", () => version),
    pauseAutomation: record("pauseAutomation", () => ({
      ...automationFor(hourly),
      status: "paused" as const,
    })),
    listAutomationVersions: record("listAutomationVersions", () => [version]),
    getAutomationRun: record("getAutomationRun", () => run),
    listAutomationRuns: record("listAutomationRuns", () => ({
      runs: [run],
      nextCursor: null,
    })),
    getAutomationRunStats: record("getAutomationRunStats", () =>
      Schema.decodeUnknownSync(AutomationRunStats)({ campaignId })
    ),
    previewCalendarExpression: record("previewCalendarExpression", () =>
      Schema.decodeUnknownSync(CalendarPreview)({
        description: "Every Monday from 9:00",
        nextStarts: [timestamp],
        frequency: frequencyFor(hourly),
      })
    ),
    createCampaign: record("createCampaign", () => campaign),
    ...overrides,
  };
  const api = Layer.succeed(WorkspaceAdminApiClient, {
    ...({} as WorkspaceAdminApiClient["Service"]),
    ...fake,
  });
  const authentication = Layer.succeed(AuthenticationService, {
    current: Effect.succeed(
      Option.some({ accessToken: Redacted.make(accessToken), session })
    ),
    save: () => Effect.void,
    clear: Effect.succeed(true),
  });
  const config = Layer.succeed(DhwConfig, {
    baseUrl: new URL("https://workspace.example.test"),
    requestHeaders: {},
    isCi: true,
    stateDirectory: join(tmpdir(), "dhw-automations-command-test"),
    updateChecksDisabled: true,
  });
  const console = Layer.succeed(Console.Console, {
    ...globalThis.console,
    log: (...args: ReadonlyArray<unknown>) => {
      output.push(args.join(" "));
    },
    error: (...args: ReadonlyArray<unknown>) => {
      errors.push(args.join(" "));
    },
  } satisfies Console.Console);

  return {
    calls,
    output,
    errors,
    layer: Layer.mergeAll(api, authentication, console).pipe(
      Layer.provideMerge(config),
      Layer.provideMerge(BunServices.layer)
    ),
  };
};

type AutomationLayer = ReturnType<typeof makeAutomationLayer>["layer"];

/** Runs a command on a test clock that keeps advancing while it runs. */
const runCommand = (args: ReadonlyArray<string>, layer: AutomationLayer) =>
  Effect.gen(function* () {
    const command = yield* Command.runWith(dhwCommand, { version: "1.24.0" })(
      args
    ).pipe(Effect.provide(layer), Effect.forkChild);
    yield* TestClock.adjust("1 second").pipe(Effect.forever, Effect.forkChild);
    return yield* Fiber.join(command);
  }).pipe(Effect.provide(TestClock.layer()));

const runSuccess = (args: ReadonlyArray<string>, layer: AutomationLayer) =>
  runCommand(args, layer).pipe(Effect.runPromise);

const runFailure = (args: ReadonlyArray<string>, layer: AutomationLayer) =>
  runCommand(args, layer).pipe(Effect.flip, Effect.runPromise);

const frequencyWarning =
  "warning: This schedule fires up to 2 times an hour. Every fire evaluates the whole audience; check this frequency is intended.";

const temporaryDirectories: string[] = [];

const writeTemporaryFile = async (contents: string) => {
  const directory = await mkdtemp(join(tmpdir(), "dhw-automations-"));
  temporaryDirectories.push(directory);
  const file = join(directory, "flow.json");
  await writeFile(file, contents);
  return file;
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe("dhw automations flow", () => {
  test("refuses a flow file with an unknown key and sends nothing", async () => {
    const fake = makeAutomationLayer();
    const file = await writeTemporaryFile(
      JSON.stringify({ ...flowFor(hourly), priority: "high" })
    );

    const error = await runFailure(
      ["automations", "flow", "set", campaignId, "--flow-file", file],
      fake.layer
    );

    expect(error).toMatchObject({ _tag: "InvalidMutationInputError" });
    expect(error.message).toStartWith("The flow is invalid:");
    expect(fake.calls).toEqual([]);
  });

  test("refuses a flow file that isn't JSON and sends nothing", async () => {
    const fake = makeAutomationLayer();
    const file = await writeTemporaryFile("{ trigger: ");

    const error = await runFailure(
      ["automations", "flow", "set", campaignId, "--flow-file", file],
      fake.layer
    );

    expect(error).toMatchObject({
      _tag: "InvalidMutationInputError",
      message: "The flow is not valid JSON.",
    });
    expect(fake.calls).toEqual([]);
  });

  test("saves a decoded flow and warns about a half-hourly schedule", async () => {
    const fake = makeAutomationLayer();
    const file = await writeTemporaryFile(JSON.stringify(flowFor(halfHourly)));

    await runSuccess(
      ["automations", "flow", "set", campaignId, "--flow-file", file],
      fake.layer
    );

    expect(fake.calls).toEqual([
      ["updateAutomationFlow", { campaignId, flow: flowFor(halfHourly) }],
    ]);
    expect(fake.errors).toEqual([frequencyWarning]);
    expect(fake.output.join("\n")).toContain(
      "Saved the flow of automation campaign-1."
    );
  });

  test("writes the working copy's flow to a file", async () => {
    const fake = makeAutomationLayer();
    const output = join(
      await mkdtemp(join(tmpdir(), "dhw-automations-")),
      "flow.json"
    );
    temporaryDirectories.push(join(output, ".."));

    await runSuccess(
      ["automations", "flow", "get", campaignId, "--output", output],
      fake.layer
    );

    expect(JSON.parse(await readFile(output, "utf8"))).toEqual(
      flowFor(halfHourly)
    );
  });
});

describe("dhw automations show and dry-run", () => {
  test("show warns about a schedule that fires more than hourly", async () => {
    const fake = makeAutomationLayer();

    await runSuccess(["automations", "show", campaignId], fake.layer);

    expect(fake.errors).toEqual([frequencyWarning]);
    expect(fake.output.join("\n")).toContain(
      "Activation\tNeeds a dry run of the current draft"
    );
  });

  test("show prints no warning for an hourly schedule", async () => {
    const fake = makeAutomationLayer({
      getAutomation: () => Effect.succeed(automationFor(hourly)),
    });

    await runSuccess(["automations", "show", campaignId], fake.layer);

    expect(fake.errors).toEqual([]);
  });

  test("show --json prints only the automation on stdout", async () => {
    const fake = makeAutomationLayer();

    await runSuccess(["automations", "show", campaignId, "--json"], fake.layer);

    expect(fake.output).toHaveLength(1);
    expect(
      Schema.decodeUnknownSync(AutomationDetail)(JSON.parse(fake.output[0]!))
    ).toEqual(automationFor(halfHourly));
    expect(fake.errors).toEqual([frequencyWarning]);
  });

  test("dry-run polls until the run settles and reads every page", async () => {
    let polls = 0;
    const reads: Array<unknown> = [];
    const fake = makeAutomationLayer({
      getAutomationDryRun: (_accessToken, input) =>
        Effect.sync(() => {
          reads.push(input);
          if (input.limit === 1) {
            polls += 1;
            return dryRunFor(halfHourly, polls < 3 ? "running" : "completed");
          }
          return input.cursor === undefined
            ? dryRunFor(halfHourly, "completed", { nextCursor: "page-2" })
            : dryRunFor(halfHourly, "completed", {
                rows: [
                  {
                    triggerAt: timestamp,
                    customerId: "customer-2",
                    customerEventId: null,
                    outcome: "not-in-audience",
                    stepId: null,
                    sendAt: null,
                    projected: true,
                  },
                ],
                customers: [
                  { customerId: "customer-2", name: null, email: null },
                ],
              });
        }),
    });

    await runSuccess(
      ["automations", "dry-run", campaignId, "--json"],
      fake.layer
    );

    expect(fake.calls).toEqual([["dryRunAutomation", campaignId]]);
    expect(reads).toEqual([
      { previewId, limit: 1 },
      { previewId, limit: 1 },
      { previewId, limit: 1 },
      { previewId },
      { previewId, cursor: "page-2" },
    ]);
    expect(fake.output).toHaveLength(1);
    const dryRun = Schema.decodeUnknownSync(AutomationDryRun)(
      JSON.parse(fake.output[0]!)
    );
    expect(dryRun.status).toBe("completed");
    expect(dryRun.rows.map((row) => String(row.customerId))).toEqual([
      "customer-1",
      "customer-2",
    ]);
    expect(
      dryRun.customers.map((customer) => String(customer.customerId))
    ).toEqual(["customer-1", "customer-2"]);
    expect(dryRun.nextCursor).toBeNull();
    expect(fake.errors).toEqual([frequencyWarning]);
  });

  test("dry-run gives up with a message when the run never settles", async () => {
    const fake = makeAutomationLayer({
      getAutomationDryRun: () =>
        Effect.succeed(dryRunFor(halfHourly, "running")),
    });

    const error = await runFailure(
      ["automations", "dry-run", campaignId],
      fake.layer
    );

    expect(error).toMatchObject({
      _tag: "AutomationDryRunTimeoutError",
      message:
        "Dry run preview-1 is still running. Run dhw automations dry-run campaign-1 again to keep waiting.",
    });
  });

  test("dry-run prints no warning for an hourly schedule", async () => {
    const fake = makeAutomationLayer({
      getAutomationDryRun: () => Effect.succeed(dryRunFor(hourly, "completed")),
    });

    await runSuccess(["automations", "dry-run", campaignId], fake.layer);

    expect(fake.errors).toEqual([]);
    expect(fake.output.join("\n")).toContain("customer-1\tAda");
  });

  test("dry-run marks rows that read reservation statuses approximately", async () => {
    const row = {
      triggerAt: timestamp,
      customerEventId: "event-1",
      stepId: null,
      sendAt: null,
    };
    const fake = makeAutomationLayer({
      getAutomationDryRun: () =>
        Effect.succeed(
          dryRunFor(hourly, "completed", {
            rows: [
              {
                ...row,
                customerId: "customer-1",
                outcome: "not-in-audience",
                reservationStatusesApproximate: true,
              },
              {
                ...row,
                customerId: "customer-2",
                outcome: "would-send",
                projected: true,
                reservationStatusesApproximate: true,
              },
            ],
          })
        ),
    });

    await runSuccess(["automations", "dry-run", campaignId], fake.layer);

    const lines = fake.output.join("\n").split("\n");
    expect(
      lines
        .find((line) => line.includes("customer-1\tAda"))
        ?.split("\t")
        .at(-1)
    ).toBe("approximate reservation status");
    expect(
      lines
        .find((line) => line.includes("customer-2"))
        ?.split("\t")
        .at(-1)
    ).toBe("projected, approximate reservation status");
  });
});

describe("dhw automations activate", () => {
  test("dry-runs the draft, prints it, then activates with its preview", async () => {
    const fake = makeAutomationLayer();

    await runSuccess(
      ["automations", "activate", campaignId, "--yes"],
      fake.layer
    );

    expect(fake.calls.map(([name]) => name)).toEqual([
      "getAutomation",
      "dryRunAutomation",
      "getAutomationDryRun",
      "getAutomationDryRun",
      "activateAutomation",
    ]);
    expect(fake.calls.at(-1)).toEqual([
      "activateAutomation",
      { campaignId, previewId },
    ]);
    expect(fake.output.join("\n")).toContain("Dry run preview-1\tschedule");
    expect(fake.output.at(-1)).toBe(
      "Activated version 1 of automation campaign-1."
    );
    expect(fake.errors).toEqual([frequencyWarning]);
  });

  test("activates with a given preview without running a dry run", async () => {
    const fake = makeAutomationLayer({
      getAutomation: () => Effect.succeed(automationFor(hourly)),
    });

    await runSuccess(
      [
        "automations",
        "activate",
        campaignId,
        "--preview",
        "preview-7",
        "--yes",
        "--json",
      ],
      fake.layer
    );

    expect(fake.calls).toEqual([
      ["activateAutomation", { campaignId, previewId: "preview-7" }],
    ]);
    expect(JSON.parse(fake.output[0]!)).toEqual({
      status: "activated",
      dryRun: null,
      version,
    });
    expect(fake.errors).toEqual([]);
  });

  test("requires --yes with --json or without a terminal", async () => {
    for (const json of [[], ["--json"]]) {
      const fake = makeAutomationLayer();

      const error = await runFailure(
        ["automations", "activate", campaignId, ...json],
        fake.layer
      );

      expect(error).toMatchObject({ _tag: "ConfirmationRequiredError" });
      expect(fake.calls.map(([name]) => name)).not.toContain(
        "activateAutomation"
      );
    }
  });

  test("surfaces the server's refusal of a preview of an older draft", async () => {
    const refusal = new CliMutationRejected({
      message: "The draft changed after this dry run. Run a new dry run.",
      code: "automation-draft-changed",
    });
    const fake = makeAutomationLayer({
      activateAutomation: () => Effect.fail(refusal),
    });

    const error = await runFailure(
      ["automations", "activate", campaignId, "--preview", previewId, "--yes"],
      fake.layer
    );

    expect(error).toBe(refusal);
  });

  test("reports nothing to activate when the working copy is published", async () => {
    const fake = makeAutomationLayer({
      getAutomation: () =>
        Effect.succeed(automationFor(hourly, { _tag: "Published" })),
    });

    await runSuccess(
      ["automations", "activate", campaignId, "--yes"],
      fake.layer
    );

    expect(fake.calls).toEqual([]);
    expect(fake.output).toEqual([
      "Automation campaign-1 has nothing to activate: its working copy is the active version.",
    ]);
  });
});

describe("dhw automations lifecycle and runs", () => {
  test("pause needs confirmation and reports the paused automation", async () => {
    const fake = makeAutomationLayer();

    const error = await runFailure(
      ["automations", "pause", campaignId],
      fake.layer
    );
    expect(error).toMatchObject({ _tag: "ConfirmationRequiredError" });
    expect(fake.calls).toEqual([]);

    await runSuccess(["automations", "pause", campaignId, "--yes"], fake.layer);
    expect(fake.calls).toEqual([["pauseAutomation", campaignId]]);
    expect(fake.output).toEqual(["Paused automation campaign-1."]);
  });

  test("runs passes every filter to the server", async () => {
    const fake = makeAutomationLayer();

    await runSuccess(
      [
        "automations",
        "runs",
        campaignId,
        "--state",
        "ended",
        "--step",
        "send",
        "--outcome",
        "skipped",
        "--skip-reason",
        "missing-email",
        "--version",
        "2",
        "--customer",
        "customer-1",
        "--cursor",
        "page-2",
        "--limit",
        "50",
      ],
      fake.layer
    );

    expect(fake.calls).toEqual([
      [
        "listAutomationRuns",
        {
          campaignId,
          state: "ended",
          stepId: "send",
          outcome: "skipped",
          skipReason: "missing-email",
          versionNumber: 2,
          customerId: "customer-1",
          cursor: "page-2",
          limit: 50,
        },
      ],
    ]);
  });

  test("runs refuses an unknown skip reason and sends nothing", async () => {
    const fake = makeAutomationLayer();

    await runFailure(
      [
        "automations",
        "runs",
        campaignId,
        "--skip-reason",
        "evaluation-unavailable",
      ],
      fake.layer
    );

    expect(fake.calls).toEqual([]);
  });

  test("runs prints each run's live contact, or the profile status without one", async () => {
    const summary = (
      customerId: string,
      contact: Record<string, unknown>,
      outcome: Record<string, unknown> = { outcome: "sent" }
    ) =>
      Schema.decodeUnknownSync(AutomationRunSummary)({
        ...run,
        timeline: undefined,
        runId: `run-${customerId}`,
        customerId,
        ...contact,
        ...outcome,
      });
    const fake = makeAutomationLayer({
      listAutomationRuns: () =>
        Effect.succeed({
          runs: [
            summary("customer-1", {
              customerName: "Ana Test",
              customerEmail: testEmailAddress("ana"),
              customerProfileStatus: "found",
            }),
            summary(
              "customer-2",
              { customerName: "Bob Test", customerProfileStatus: "found" },
              { outcome: "skipped", outcomeReason: "missing-email" }
            ),
            summary("customer-3", { customerProfileStatus: "not-found" }),
            summary("customer-4", {}),
          ],
          nextCursor: null,
        }),
    });

    await runSuccess(["automations", "runs", campaignId], fake.layer);

    const rows = fake.output.join("\n").split("\n").slice(1);
    expect(rows.map((row) => row.split("\t").slice(2, 5))).toEqual([
      ["customer-1", "Ana Test", testEmailAddress("ana")],
      ["customer-2", "Bob Test", ""],
      ["customer-3", "(profile not-found)", ""],
      ["customer-4", "(profile unavailable)", ""],
    ]);
    expect(rows[1]!.split("\t").at(-1)).toBe("skipped (missing-email)");
  });

  test("stats prints the skipped runs by each reason that has any", async () => {
    const requested: unknown[] = [];
    const fake = makeAutomationLayer({
      getAutomationRunStats: (_accessToken, input) =>
        Effect.sync(() => requested.push(input)).pipe(
          Effect.as(
            Schema.decodeUnknownSync(AutomationRunStats)({
              campaignId,
              bySkipReason: {
                "missing-from-dotypos": 0,
                "deleted-customer": 0,
                "missing-email": 2,
                "invalid-email": 0,
                "consent-withdrawn": 1,
                "outside-test-domain": 0,
              },
            })
          )
        ),
    });

    await runSuccess(
      ["automations", "stats", campaignId, "--version", "2"],
      fake.layer
    );

    expect(requested).toEqual([{ campaignId, versionNumber: 2 }]);
    expect(
      fake.output
        .join("\n")
        .split("\n")
        .filter((line) => line.startsWith("skipped ("))
    ).toEqual(["skipped (missing-email)\t2", "skipped (consent-withdrawn)\t1"]);
  });

  test("run prints the timeline with each entry's detail", async () => {
    const fake = makeAutomationLayer();

    await runSuccess(["automations", "run", "run-1"], fake.layer);

    expect(fake.calls).toEqual([["getAutomationRun", { runId: "run-1" }]]);
    expect(fake.output.join("\n")).toContain(
      `1\t${timestamp}\tskipped\tsend\t{"reason":"no-consent"}`
    );
  });
});

describe("dhw calendar describe", () => {
  test("describes an expression as a wait step with --wait", async () => {
    const fake = makeAutomationLayer();

    await runSuccess(
      [
        "calendar",
        "describe",
        "--expression",
        '{"weekdays":["monday"],"hours":[9]}',
        "--wait",
      ],
      fake.layer
    );

    expect(fake.calls).toEqual([
      [
        "previewCalendarExpression",
        {
          expression: { weekdays: ["monday"], hours: [9] },
          usage: "wait",
          locale: "en-US",
        },
      ],
    ]);
    expect(fake.output.join("\n")).toContain("Fires up to 1 times an hour");
  });

  test("describes a trigger by default and refuses unknown keys", async () => {
    const fake = makeAutomationLayer();

    await runSuccess(
      ["calendar", "describe", "--expression", '{"hours":[9]}'],
      fake.layer
    );
    expect(fake.calls).toEqual([
      [
        "previewCalendarExpression",
        { expression: { hours: [9] }, usage: "trigger", locale: "en-US" },
      ],
    ]);

    const error = await runFailure(
      ["calendar", "describe", "--expression", '{"hours":[9],"days":[1]}'],
      fake.layer
    );
    expect(error).toMatchObject({ _tag: "InvalidMutationInputError" });
    expect(fake.calls).toHaveLength(1);
  });
});

describe("dhw campaigns create --delivery", () => {
  test("sends the chosen delivery", async () => {
    const fake = makeAutomationLayer();
    const body = await writeTemporaryFile("Hello");

    await runSuccess(
      [
        "campaigns",
        "create",
        "--title",
        "Welcome series",
        "--purpose",
        "operational",
        "--delivery",
        "automated",
        "--subject",
        "en=Welcome",
        "--body",
        `en=${body}`,
      ],
      fake.layer
    );

    expect(fake.calls).toEqual([
      [
        "createCampaign",
        expect.anything(),
        expect.objectContaining({ delivery: "automated" }),
      ],
    ]);
  });
});
