import {
  AdministrationCampaignId,
  type AdministrationCampaignIdType,
  AdministrationCampaignRecipientSkipReason,
  AdministrationDotyposCustomerId,
  type AutomationActivationType,
  type AutomationDetailType,
  type AutomationDryRunType,
  type AutomationEngineHealthType,
  AutomationFlow,
  type AutomationFrequencyType,
  AutomationPageCursor,
  AutomationPreviewId,
  type AutomationPreviewIdType,
  AutomationPreviewOutcome,
  type AutomationRunDetailType,
  AutomationRunId,
  AutomationRunOutcome,
  type AutomationRunPageType,
  AutomationRunState,
  type AutomationRunStatsType,
  type AutomationRunSummaryType,
  AutomationStepId,
  type AutomationVersionDetailType,
  AutomationVersionNumber,
  type AutomationVersionSummaryType,
  type CliAccessTokenType,
} from "@deskohub/workspace-admin-api";
import {
  Console,
  Data,
  Effect,
  FileSystem,
  Option,
  type Redacted,
  Schema,
} from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import type { WorkspaceAdminApiClient } from "../api/workspace-admin-api-client.service";
import {
  confirmationFlag,
  confirmChange,
  reportCancellation,
  runAuthenticatedCommand,
} from "../command-runtime";
import { readJsonInputFile } from "../json-input";
import { pollUntil } from "../polling";

type Api = WorkspaceAdminApiClient["Service"];
type AccessToken = Redacted.Redacted<CliAccessTokenType>;

const campaignIdArgument = Argument.string("campaign-id").pipe(
  Argument.withSchema(AdministrationCampaignId)
);

class AutomationFlowMissingError extends Data.TaggedError(
  "AutomationFlowMissingError"
)<{ readonly message: string }> {}

class AutomationDryRunTimeoutError extends Data.TaggedError(
  "AutomationDryRunTimeoutError"
)<{ readonly message: string }> {}

/** A dry run normally settles within minutes; rerunning reuses it. */
const dryRunTimeout = "15 minutes";

const red = (text: string) =>
  process.stderr.isTTY === true && process.env.NO_COLOR === undefined
    ? `\u001b[31m${text}\u001b[39m`
    : text;

/**
 * The D33 warning for a schedule that fires more than hourly. It goes to
 * stderr, so `--json` keeps stdout for the result. Never a gate.
 */
const reportFrequencyWarning = (frequency: AutomationFrequencyType | null) =>
  frequency?.firesMoreThanHourly === true
    ? Console.error(
        `${red("warning:")} This schedule fires up to ${frequency.maxFiresPerHour} times an hour. Every fire evaluates the whole audience; check this frequency is intended.`
      )
    : Effect.void;

const describeActivation = (activation: AutomationActivationType) => {
  switch (activation._tag) {
    case "PreviewRequired":
      return "Needs a dry run of the current draft";
    case "PreviewRunning":
      return `Dry run ${activation.previewId} running (${activation.unitsDone}/${activation.unitsTotal})`;
    case "Ready":
      return `Ready with dry run ${activation.previewId}`;
    case "Published":
      return "Published: the working copy is the active version";
  }
};

const describeVersion = (version: AutomationVersionSummaryType) =>
  [
    `version ${version.versionNumber}`,
    `activated ${version.activatedAt}`,
    `by ${version.activatedByEmail ?? "a deleted account"}`,
  ].join(", ");

const formatAutomationDetail = (automation: AutomationDetailType) =>
  [
    [automation.campaignId, automation.status].join("\t"),
    `Trigger\t${automation.trigger?.kind ?? "No flow saved"}`,
    `Activation\t${describeActivation(automation.activation)}`,
    `Active version\t${
      automation.activeVersion === null
        ? "None"
        : describeVersion(automation.activeVersion)
    }`,
    `Versions\t${automation.versionCount}`,
    `Pending changes\t${automation.pendingChanges ? "yes" : "no"}`,
    ...(automation.acceptingSince === null
      ? []
      : [`Accepting since\t${automation.acceptingSince}`]),
    ...(automation.pausedAt === null ? [] : [`Paused\t${automation.pausedAt}`]),
    ...(automation.archivedAt === null
      ? []
      : [`Archived\t${automation.archivedAt}`]),
    ...(automation.nextFireAt === null
      ? []
      : [`Next fire\t${automation.nextFireAt}`]),
    `Updated\t${automation.updatedAt}`,
  ].join("\n");

const reportAutomation = (
  json: boolean,
  automation: AutomationDetailType,
  summary: string
) =>
  Effect.gen(function* () {
    yield* reportFrequencyWarning(automation.trigger?.frequency ?? null);
    yield* Console.log(json ? JSON.stringify(automation) : summary);
  });

const automationsShowCommand = Command.make(
  "show",
  { campaignId: campaignIdArgument },
  ({ campaignId }) =>
    runAuthenticatedCommand((api, accessToken, json) =>
      api
        .getAutomation(accessToken, campaignId)
        .pipe(
          Effect.flatMap((automation) =>
            reportAutomation(
              json,
              automation,
              formatAutomationDetail(automation)
            )
          )
        )
    )
).pipe(
  Command.withDescription(
    "Show an automated campaign's status, working copy and activation readiness"
  )
);

const automationsFlowGetCommand = Command.make(
  "get",
  {
    campaignId: campaignIdArgument,
    output: Flag.string("output").pipe(
      Flag.optional,
      Flag.withDescription("Write the flow JSON to this file")
    ),
  },
  ({ campaignId, output }) =>
    runAuthenticatedCommand((api, accessToken, json) =>
      Effect.gen(function* () {
        const { flow } = yield* api.getAutomation(accessToken, campaignId);
        if (Option.isNone(output)) {
          yield* Console.log(
            json ? JSON.stringify(flow) : JSON.stringify(flow, null, 2)
          );
          return;
        }
        if (flow === null) {
          return yield* new AutomationFlowMissingError({
            message: `Automation ${campaignId} has no saved flow to write.`,
          });
        }
        const fileSystem = yield* FileSystem.FileSystem;
        yield* fileSystem.writeFileString(
          output.value,
          `${JSON.stringify(flow, null, 2)}\n`
        );
        yield* Console.log(
          json
            ? JSON.stringify({ campaignId, output: output.value })
            : `Wrote the flow of automation ${campaignId} to ${output.value}.`
        );
      })
    )
).pipe(
  Command.withDescription(
    "Print the working copy's flow as JSON, or write it to a file"
  )
);

const automationsFlowSetCommand = Command.make(
  "set",
  {
    campaignId: campaignIdArgument,
    flowFile: Flag.string("flow-file").pipe(
      Flag.withDescription(
        "JSON file with the flow's trigger and steps; unknown keys are refused"
      )
    ),
  },
  ({ campaignId, flowFile }) =>
    runAuthenticatedCommand((api, accessToken, json) =>
      Effect.gen(function* () {
        const flow = yield* readJsonInputFile(AutomationFlow, "flow", flowFile);
        const automation = yield* api.updateAutomationFlow(accessToken, {
          campaignId,
          flow,
        });
        yield* reportAutomation(
          json,
          automation,
          [
            `Saved the flow of automation ${campaignId}.`,
            `Activation\t${describeActivation(automation.activation)}`,
          ].join("\n")
        );
      })
    )
).pipe(Command.withDescription("Replace the working copy's flow"));

const automationsFlowCommand = Command.make("flow").pipe(
  Command.withDescription("Read or replace an automation's working copy"),
  Command.withSubcommands([
    automationsFlowGetCommand,
    automationsFlowSetCommand,
  ])
);

/** Every page of a settled dry run, merged into one result. */
const readDryRunPages = (
  api: Api,
  accessToken: AccessToken,
  previewId: AutomationPreviewIdType
) =>
  Effect.gen(function* () {
    const first = yield* api.getAutomationDryRun(accessToken, { previewId });
    const rows = [...first.rows];
    const customers = new Map(
      first.customers.map((customer) => [customer.customerId, customer])
    );
    let cursor = first.nextCursor;
    while (cursor !== null) {
      const page = yield* api.getAutomationDryRun(accessToken, {
        previewId,
        cursor,
      });
      rows.push(...page.rows);
      for (const customer of page.customers) {
        customers.set(customer.customerId, customer);
      }
      cursor = page.nextCursor;
    }
    return {
      ...first,
      rows,
      customers: [...customers.values()],
      nextCursor: null,
    } satisfies AutomationDryRunType;
  });

/**
 * Starts the dry run of the current draft, or reuses the one already
 * running or completed, waits until it settles and reads all its rows.
 */
const runDryRun = (
  api: Api,
  accessToken: AccessToken,
  campaignId: AdministrationCampaignIdType
) =>
  Effect.gen(function* () {
    const { previewId } = yield* api.dryRunAutomation(accessToken, campaignId);
    yield* pollUntil(
      api.getAutomationDryRun(accessToken, { previewId, limit: 1 }),
      {
        settled: (dryRun) => dryRun.status !== "running",
        timeout: dryRunTimeout,
        onTimeout: () =>
          new AutomationDryRunTimeoutError({
            message: `Dry run ${previewId} is still running. Run dhw automations dry-run ${campaignId} again to keep waiting.`,
          }),
      }
    );
    return yield* readDryRunPages(api, accessToken, previewId);
  });

const formatDryRun = (dryRun: AutomationDryRunType) => {
  const customers = new Map(
    dryRun.customers.map((customer) => [customer.customerId, customer])
  );
  return [
    [
      `Dry run ${dryRun.previewId}`,
      dryRun.kind,
      dryRun.errorCode === null
        ? dryRun.status
        : `${dryRun.status} (${dryRun.errorCode})`,
    ].join("\t"),
    `Draft\t${dryRun.draftHash}`,
    `As of\t${dryRun.asOf}`,
    `Units\t${dryRun.unitsDone}/${dryRun.unitsTotal}`,
    ...(dryRun.nextFires.length === 0
      ? []
      : [`Next fires\t${dryRun.nextFires.join(", ")}`]),
    ...(dryRun.eventsTotal === null
      ? []
      : [
          `Events\t${dryRun.eventsTotal}${dryRun.truncated ? " (truncated: only the most recent are evaluated)" : ""}`,
        ]),
    ...AutomationPreviewOutcome.literals.map(
      (outcome) => `${outcome}\t${dryRun.counts[outcome]}`
    ),
    ...(dryRun.profileFactsAreCurrent
      ? [
          "Conditions on tags, discount group, locale and consent used the customers' current profiles.",
        ]
      : []),
    `Rows: ${dryRun.rows.length}`,
    ...dryRun.rows.map((row) => {
      const customer = customers.get(row.customerId);
      return [
        row.triggerAt,
        row.customerId,
        customer?.name ?? "",
        customer?.email ?? "",
        row.outcome,
        row.stepId ?? "",
        row.sendAt ?? "",
        [
          ...(row.projected ? ["projected"] : []),
          ...(row.reservationStatusesApproximate
            ? ["approximate reservation status"]
            : []),
        ].join(", "),
      ].join("\t");
    }),
    `Emails: ${dryRun.emails.length}`,
    ...dryRun.emails.map((email) => `${email.locale}\t${email.subject}`),
  ].join("\n");
};

const reportDryRun = (dryRun: AutomationDryRunType) =>
  Effect.gen(function* () {
    yield* reportFrequencyWarning(dryRun.frequency);
    yield* Console.log(formatDryRun(dryRun));
  });

const automationsDryRunCommand = Command.make(
  "dry-run",
  { campaignId: campaignIdArgument },
  ({ campaignId }) =>
    runAuthenticatedCommand((api, accessToken, json) =>
      Effect.gen(function* () {
        const dryRun = yield* runDryRun(api, accessToken, campaignId);
        if (json) {
          yield* reportFrequencyWarning(dryRun.frequency);
          yield* Console.log(JSON.stringify(dryRun));
          return;
        }
        yield* reportDryRun(dryRun);
      })
    )
).pipe(
  Command.withDescription(
    "Dry-run the working copy against live audiences and wait for the result"
  )
);

const automationsActivateCommand = Command.make(
  "activate",
  {
    campaignId: campaignIdArgument,
    preview: Flag.string("preview").pipe(
      Flag.withSchema(AutomationPreviewId),
      Flag.optional,
      Flag.withDescription(
        "Activate with this completed dry run instead of running one"
      )
    ),
    yes: confirmationFlag,
  },
  ({ campaignId, preview, yes }) =>
    runAuthenticatedCommand((api, accessToken, json) =>
      Effect.gen(function* () {
        const automation = yield* api.getAutomation(accessToken, campaignId);
        if (automation.activation._tag === "Published") {
          yield* Console.log(
            json
              ? JSON.stringify({ status: "published", automation })
              : `Automation ${campaignId} has nothing to activate: its working copy is the active version.`
          );
          return;
        }
        const { dryRun, previewId } = yield* Option.match(preview, {
          onNone: () =>
            runDryRun(api, accessToken, campaignId).pipe(
              Effect.map((dryRun) => ({
                dryRun: Option.some(dryRun),
                previewId: dryRun.previewId,
              }))
            ),
          onSome: (previewId) =>
            Effect.succeed({
              dryRun: Option.none<AutomationDryRunType>(),
              previewId,
            }),
        });
        if (!json && Option.isSome(dryRun)) {
          yield* Console.log(formatDryRun(dryRun.value));
        }
        yield* reportFrequencyWarning(
          Option.match(dryRun, {
            onNone: () => automation.trigger?.frequency ?? null,
            onSome: ({ frequency }) => frequency,
          })
        );
        const confirmed = yield* confirmChange(
          "automations.activateAutomation",
          yes,
          json,
          `Activate automation ${campaignId} with dry run ${previewId}? New runs start on the new version.`
        );
        if (!confirmed) {
          yield* reportCancellation(json);
          return;
        }
        const version = yield* api.activateAutomation(accessToken, {
          campaignId,
          previewId,
        });
        yield* Console.log(
          json
            ? JSON.stringify({
                status: "activated",
                dryRun: Option.getOrNull(dryRun),
                version,
              })
            : `Activated version ${version.versionNumber} of automation ${campaignId}.`
        );
      })
    )
).pipe(
  Command.withDescription(
    "Publish the working copy after a completed dry run of it"
  )
);

const lifecycleCommand = (
  name: "pause" | "resume" | "archive",
  {
    description,
    prompt,
    verb,
  }: {
    readonly description: string;
    readonly prompt: (campaignId: AdministrationCampaignIdType) => string;
    readonly verb: string;
  },
  apply: (api: Api) => Api["pauseAutomation"]
) =>
  Command.make(
    name,
    { campaignId: campaignIdArgument, yes: confirmationFlag },
    ({ campaignId, yes }) =>
      runAuthenticatedCommand((api, accessToken, json) =>
        Effect.gen(function* () {
          const confirmed = yield* confirmChange(
            `automations.${name}Automation`,
            yes,
            json,
            prompt(campaignId)
          );
          if (!confirmed) {
            yield* reportCancellation(json);
            return;
          }
          const automation = yield* apply(api)(accessToken, campaignId);
          yield* Console.log(
            json
              ? JSON.stringify(automation)
              : `${verb} automation ${campaignId}.`
          );
        })
      )
  ).pipe(Command.withDescription(description));

const automationsPauseCommand = lifecycleCommand(
  "pause",
  {
    description: "Stop starting and advancing runs until resumed",
    prompt: (campaignId) =>
      `Pause automation ${campaignId}? No new runs start and waiting runs hold until you resume it.`,
    verb: "Paused",
  },
  (api) => api.pauseAutomation
);

const automationsResumeCommand = lifecycleCommand(
  "resume",
  {
    description: "Resume a paused automation",
    prompt: (campaignId) =>
      `Resume automation ${campaignId}? Runs start and advance again.`,
    verb: "Resumed",
  },
  (api) => api.resumeAutomation
);

const automationsArchiveCommand = lifecycleCommand(
  "archive",
  {
    description: "End an automation and its open runs for good",
    prompt: (campaignId) =>
      `Archive automation ${campaignId}? Its open runs end and it cannot be reactivated.`,
    verb: "Archived",
  },
  (api) => api.archiveAutomation
);

const formatVersionRow = (version: AutomationVersionSummaryType) =>
  [
    version.versionNumber,
    version.trigger.kind,
    version.activatedAt,
    version.activatedByEmail ?? "Deleted account",
    version.active ? "active" : "",
  ].join("\t");

const formatVersionDetail = (version: AutomationVersionDetailType) =>
  [
    [
      `Version ${version.versionNumber}`,
      version.campaignId,
      version.active ? "active" : "inactive",
    ].join("\t"),
    `Activated\t${version.activatedAt}`,
    `By\t${version.activatedByEmail ?? "Deleted account"}`,
    `Purpose\t${version.purpose}`,
    `Template\t${version.templateKey}`,
    `Audience\t${version.audienceId ?? "None"}`,
    `Draft\t${version.draftHash}`,
    "",
    JSON.stringify(version.flow, null, 2),
  ].join("\n");

const automationsVersionsCommand = Command.make(
  "versions",
  {
    campaignId: campaignIdArgument,
    versionNumber: Argument.integer("version").pipe(
      Argument.withSchema(AutomationVersionNumber),
      Argument.optional,
      Argument.withDescription("Show this version's frozen flow and content")
    ),
  },
  ({ campaignId, versionNumber }) =>
    runAuthenticatedCommand((api, accessToken, json) =>
      Option.match(versionNumber, {
        onNone: () =>
          api
            .listAutomationVersions(accessToken, campaignId)
            .pipe(
              Effect.flatMap((versions) =>
                json
                  ? Console.log(JSON.stringify(versions))
                  : Console.log(
                      [
                        `Versions: ${versions.length}`,
                        ...versions.map(formatVersionRow),
                      ].join("\n")
                    )
              )
            ),
        onSome: (number) =>
          api
            .getAutomationVersion(accessToken, {
              campaignId,
              versionNumber: number,
            })
            .pipe(
              Effect.flatMap((version) =>
                Console.log(
                  json ? JSON.stringify(version) : formatVersionDetail(version)
                )
              )
            ),
      })
    )
).pipe(Command.withDescription("List published versions, or show one version"));

const describeRunProgress = (run: AutomationRunSummaryType) => {
  if (run.outcome === null) return run.phase ?? "";
  return run.outcomeReason === null
    ? run.outcome
    : `${run.outcome} (${run.outcomeReason})`;
};

/** The customer's current name and email, or why they're missing. */
const describeRunCustomer = (run: AutomationRunSummaryType) =>
  run.customerProfileStatus === "found"
    ? [run.customerName ?? "", run.customerEmail ?? ""]
    : [`(profile ${run.customerProfileStatus})`, ""];

const formatRunRow = (run: AutomationRunSummaryType) =>
  [
    run.runId,
    `v${run.versionNumber}`,
    run.customerId,
    ...describeRunCustomer(run),
    run.triggerAt,
    run.state,
    run.stepId,
    describeRunProgress(run),
  ].join("\t");

const formatRunPage = (page: AutomationRunPageType) =>
  [
    `Runs: ${page.runs.length}`,
    ...page.runs.map(formatRunRow),
    ...(page.nextCursor === null
      ? []
      : [`More runs: pass --cursor ${page.nextCursor}`]),
  ].join("\n");

const automationsRunsCommand = Command.make(
  "runs",
  {
    campaignId: campaignIdArgument,
    state: Flag.choice("state", AutomationRunState.literals).pipe(
      Flag.optional,
      Flag.withDescription("Only runs in this state")
    ),
    step: Flag.string("step").pipe(
      Flag.withSchema(AutomationStepId),
      Flag.optional,
      Flag.withDescription("Only runs at this step, or that ended at it")
    ),
    outcome: Flag.choice("outcome", AutomationRunOutcome.literals).pipe(
      Flag.optional,
      Flag.withDescription("Only ended runs with this outcome")
    ),
    skipReason: Flag.choice(
      "skip-reason",
      AdministrationCampaignRecipientSkipReason.literals
    ).pipe(
      Flag.optional,
      Flag.withDescription("Only runs skipped for this reason")
    ),
    version: Flag.integer("version").pipe(
      Flag.withSchema(AutomationVersionNumber),
      Flag.optional,
      Flag.withDescription("Only runs of this version")
    ),
    customer: Flag.string("customer").pipe(
      Flag.withSchema(AdministrationDotyposCustomerId),
      Flag.optional,
      Flag.withDescription("Only this customer's runs")
    ),
    cursor: Flag.string("cursor").pipe(
      Flag.withSchema(AutomationPageCursor),
      Flag.optional,
      Flag.withDescription("Continue after a previous page")
    ),
    limit: Flag.integer("limit").pipe(
      Flag.withSchema(
        Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))
      ),
      Flag.optional,
      Flag.withDescription("Runs per page, at most 100")
    ),
  },
  ({
    campaignId,
    cursor,
    customer,
    limit,
    outcome,
    skipReason,
    state,
    step,
    version,
  }) =>
    runAuthenticatedCommand((api, accessToken, json) =>
      api
        .listAutomationRuns(accessToken, {
          campaignId,
          ...(Option.isSome(state) && { state: state.value }),
          ...(Option.isSome(step) && { stepId: step.value }),
          ...(Option.isSome(outcome) && { outcome: outcome.value }),
          ...(Option.isSome(skipReason) && { skipReason: skipReason.value }),
          ...(Option.isSome(version) && { versionNumber: version.value }),
          ...(Option.isSome(customer) && { customerId: customer.value }),
          ...(Option.isSome(cursor) && { cursor: cursor.value }),
          ...(Option.isSome(limit) && { limit: limit.value }),
        })
        .pipe(
          Effect.flatMap((page) =>
            Console.log(json ? JSON.stringify(page) : formatRunPage(page))
          )
        )
    )
).pipe(Command.withDescription("List an automation's runs, newest first"));

const formatRunDetail = (run: AutomationRunDetailType) =>
  [
    formatRunRow(run),
    `Started\t${run.startedAt}`,
    ...(run.dueAt === null ? [] : [`Due\t${run.dueAt}`]),
    ...(run.endedAt === null ? [] : [`Ended\t${run.endedAt}`]),
    ...(run.sendId === null ? [] : [`Send\t${run.sendId}`]),
    `Timeline: ${run.timeline.length}`,
    ...run.timeline.map((entry) =>
      [
        entry.sequence,
        entry.at,
        entry.kind,
        entry.stepId ?? "",
        Object.keys(entry.detail).length === 0
          ? ""
          : JSON.stringify(entry.detail),
      ].join("\t")
    ),
  ].join("\n");

const automationsRunCommand = Command.make(
  "run",
  {
    runId: Argument.string("run-id").pipe(Argument.withSchema(AutomationRunId)),
  },
  ({ runId }) =>
    runAuthenticatedCommand((api, accessToken, json) =>
      api
        .getAutomationRun(accessToken, { runId })
        .pipe(
          Effect.flatMap((run) =>
            Console.log(json ? JSON.stringify(run) : formatRunDetail(run))
          )
        )
    )
).pipe(Command.withDescription("Show one run with its timeline"));

const formatRunStats = (stats: AutomationRunStatsType) =>
  [
    `${stats.campaignId}\t${
      stats.versionNumber === null
        ? "all versions"
        : `version ${stats.versionNumber}`
    }`,
    ...AutomationRunState.literals.map(
      (state) => `${state}\t${stats.byState[state]}`
    ),
    ...AutomationRunOutcome.literals.map(
      (outcome) => `${outcome}\t${stats.byOutcome[outcome]}`
    ),
    ...AdministrationCampaignRecipientSkipReason.literals.flatMap((reason) =>
      stats.bySkipReason[reason] === 0
        ? []
        : [`skipped (${reason})\t${stats.bySkipReason[reason]}`]
    ),
    `Steps: ${stats.bySteps.length}`,
    ...stats.bySteps.map((step) =>
      [
        step.stepId,
        ...AutomationRunState.literals.map(
          (state) => `${state} ${step.byState[state]}`
        ),
        ...AutomationRunOutcome.literals.flatMap((outcome) =>
          step.byOutcome[outcome] === 0
            ? []
            : [`${outcome} ${step.byOutcome[outcome]}`]
        ),
      ].join("\t")
    ),
  ].join("\n");

const automationsStatsCommand = Command.make(
  "stats",
  {
    campaignId: campaignIdArgument,
    version: Flag.integer("version").pipe(
      Flag.withSchema(AutomationVersionNumber),
      Flag.optional,
      Flag.withDescription("Count only this version's runs")
    ),
  },
  ({ campaignId, version }) =>
    runAuthenticatedCommand((api, accessToken, json) =>
      api
        .getAutomationRunStats(accessToken, {
          campaignId,
          ...(Option.isSome(version) && { versionNumber: version.value }),
        })
        .pipe(
          Effect.flatMap((stats) =>
            Console.log(json ? JSON.stringify(stats) : formatRunStats(stats))
          )
        )
    )
).pipe(
  Command.withDescription(
    "Count an automation's runs by state, outcome and step"
  )
);

const formatEngineHealth = (health: AutomationEngineHealthType) =>
  [
    `Last planned\t${health.lastPlannedAt ?? "Never"}`,
    `Sweep lag\t${health.sweepLagSeconds === null ? "None" : `${health.sweepLagSeconds}s`}`,
    `Reconcile lag\t${health.reconcileLagSeconds === null ? "None" : `${health.reconcileLagSeconds}s`}`,
    `Oldest unprocessed event\t${health.oldestUnprocessedEventAt ?? "None"}`,
    `Oldest planned unit\t${health.oldestPlannedUnitAt ?? "None"}`,
    `Deadline misses\t${health.deadlineMisses}`,
    `Warnings\t${health.warnings.join(", ") || "None"}`,
    `Automations: ${health.automations.length}`,
    ...health.automations.map((automation) =>
      [
        automation.campaignId,
        automation.scheduleLagSeconds === null
          ? "no lag"
          : `lag ${automation.scheduleLagSeconds}s`,
        automation.enteringFire === null
          ? ""
          : `entering ${automation.enteringFire.fireAt} (${automation.enteringFire.chunksDone}/${automation.enteringFire.chunksTotal})`,
        automation.lastFire === null
          ? ""
          : `last fire ${automation.lastFire.fireAt} took ${automation.lastFire.durationSeconds}s${automation.lastFire.fallingBehind ? " (falling behind)" : ""}`,
      ].join("\t")
    ),
    `Units: ${health.units.length}`,
    ...health.units.map((unit) =>
      [unit.kind, unit.status, unit.count].join("\t")
    ),
    ...health.retryingUnits.map((unit) =>
      [unit.kind, "retrying", unit.errorCode ?? "", unit.count].join("\t")
    ),
  ].join("\n");

const automationsEngineHealthCommand = Command.make("engine-health", {}, () =>
  runAuthenticatedCommand((api, accessToken, json) =>
    api
      .getAutomationEngineHealth(accessToken)
      .pipe(
        Effect.flatMap((health) =>
          Console.log(
            json ? JSON.stringify(health) : formatEngineHealth(health)
          )
        )
      )
  )
).pipe(
  Command.withDescription(
    "Show the automation engine's lags, backlogs and warnings"
  )
);

export const automationsCommand = Command.make("automations").pipe(
  Command.withDescription(
    "Build, dry-run, activate and inspect automated email campaigns"
  ),
  Command.withSubcommands([
    automationsShowCommand,
    automationsFlowCommand,
    automationsDryRunCommand,
    automationsActivateCommand,
    automationsPauseCommand,
    automationsResumeCommand,
    automationsArchiveCommand,
    automationsVersionsCommand,
    automationsRunsCommand,
    automationsRunCommand,
    automationsStatsCommand,
    automationsEngineHealthCommand,
  ])
);
