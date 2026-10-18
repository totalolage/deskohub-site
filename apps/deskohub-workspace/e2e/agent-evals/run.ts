import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { BrowserContext, LaunchOptions } from "@playwright/test";
import { Effect, Schema } from "effect";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import type { Locale } from "@/features/i18n";
import { makeWorkspaceE2EAccountRecipientForRunId } from "../account/config";
import { createSyntheticCustomerProfile } from "../account/fixtures";
import {
  makeWorkspaceE2EAccountJournalRecorder,
  readWorkspaceE2EAccountJournal,
  writeWorkspaceE2EAccountJournal,
} from "../account/journal";
import {
  prepareWorkspaceE2EAccountJournalReconciliations,
  reconcileWorkspaceE2EAccountJournals,
} from "../account/reconcile";
import {
  resolveWorkspaceE2ESessionSigningSecret,
  seedWorkspaceE2ESyntheticAccount,
  signInWorkspaceE2ESyntheticBrowserContext,
} from "../account/seeded-session";
import { primePreviewBypass } from "../admin-case";
import type { DatasourceConfig } from "../config";
import { tryWorkspaceE2EPromise } from "../errors";
import { workspaceE2ERunIdSchema } from "../run-identifiers";
import { workspaceAgentEvalTimeouts, workspaceE2ETimeouts } from "../timeouts";
import { launchAgentEvalBrowser } from "./browser";
import type { AgentEvalRuntime, AgentEvalSettings } from "./environment";
import type { AgentEvalHarness, AgentEvalRequest } from "./harness-contract";
import { runAgentEvalHarness } from "./harness-process";
import {
  type AgentEvalJudgement,
  type AgentEvalStatusPageCheck,
  classifyAgentEvalFailure,
  judgeAgentEvalFacts,
  judgeAgentEvalReservation,
} from "./judges";
import { observeAgentEvalBrowser } from "./observations";
import { selectAgentEvalTaskParameters } from "./parameters";
import {
  readAgentEvalReservationIds,
  readAgentEvalReservations,
} from "./records";
import type { AgentEvalRunResult } from "./results";
import {
  type AgentEvalRunSet,
  agentEvalJournalDirectory,
  writeAgentEvalRunResult,
} from "./run-set";
import { type AgentEvalTaskId, makeAgentEvalPrompt } from "./tasks";

/** The agent's budget per task. */
export const agentEvalTaskBudgetMs = (taskId: AgentEvalTaskId) => {
  if (taskId === "facts") return workspaceAgentEvalTimeouts.factsTask;
  if (taskId === "open-space-payment") {
    return workspaceAgentEvalTimeouts.paymentTask;
  }
  return workspaceAgentEvalTimeouts.bookingTask;
};

/** The one recipient label each run's synthetic account derives from. */
const agentEvalRecipientLabel = "agent";

const agentEvalJournalOwner = (runSetId: string, runId: string) => ({
  journalDirectory: agentEvalJournalDirectory(runSetId),
  ownerId: runId,
  recipientLabels: [agentEvalRecipientLabel],
});

/** A short opaque id; the synthetic recipient's local part derives from it. */
const makeAgentEvalRunId = () =>
  Schema.decodeSync(workspaceE2ERunIdSchema)(
    `ae-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`
  );

/**
 * Cancels the run's reservations, expires its Dotypos profile, and deletes
 * its account, by the journal. Reservations the account authored after the
 * journal last changed are added first, so an interrupted run still cleans
 * up. Idempotent, so suite teardown repeats it for every journal.
 */
export const reconcileAgentEvalRun = Effect.fn("reconcileAgentEvalRun")(
  function* (
    datasourceConfig: DatasourceConfig,
    runSetId: string,
    ownerId: string
  ) {
    const runId = Schema.decodeSync(workspaceE2ERunIdSchema)(ownerId);
    const owner = agentEvalJournalOwner(runSetId, runId);
    const journal = yield* tryWorkspaceE2EPromise(
      "read agent eval journal",
      () =>
        readWorkspaceE2EAccountJournal(owner.ownerId, owner.journalDirectory)
    );
    if (!journal) return;
    const [accountId] = journal.authUserIds;
    const [customerId] = journal.dotyposCustomerIds;
    if (accountId && customerId) {
      const reservationIds = yield* readAgentEvalReservationIds(
        accountId,
        customerId
      );
      if (
        reservationIds.some((id) => !journal.dotyposReservationIds.includes(id))
      ) {
        yield* tryWorkspaceE2EPromise("journal agent eval reservations", () =>
          writeWorkspaceE2EAccountJournal(
            {
              ...journal,
              dotyposReservationIds: [
                ...new Set([
                  ...journal.dotyposReservationIds,
                  ...reservationIds,
                ]),
              ],
            },
            owner.journalDirectory
          )
        );
      }
    }
    const prepared = yield* prepareWorkspaceE2EAccountJournalReconciliations(
      datasourceConfig,
      runId,
      [owner]
    );
    yield* reconcileWorkspaceE2EAccountJournals(datasourceConfig, prepared);
  }
);

const truncate = (value: string | undefined, length: number) =>
  value === undefined ? null : value.slice(0, length);

/**
 * Opens the status page the agent last reached and waits for the confirmed
 * reservation, which shows only once the paid reservation is fulfilled.
 */
const checkStatusPage = async (
  context: BrowserContext,
  statusPageUrl: string | null
): Promise<AgentEvalStatusPageCheck> => {
  if (!statusPageUrl) return { confirmed: false, reachedByAgent: false };
  const page = await context.newPage();
  try {
    await page.goto(statusPageUrl, {
      timeout: workspaceE2ETimeouts.browserNavigation,
    });
    await page.locator("#checkout-status-access").waitFor({
      state: "visible",
      timeout: workspaceAgentEvalTimeouts.statusPage,
    });
    return { confirmed: true, reachedByAgent: true };
  } catch {
    return { confirmed: false, reachedByAgent: true };
  } finally {
    await page.close();
  }
};

/**
 * Runs one agent through one task: seeds a signed-in synthetic account,
 * opens the start page in a CDP-attachable browser, hands the task to the
 * harness, judges the outcome from server records, writes the result, and
 * reconciles everything the run created.
 */
export const runAgentEvalCase = async ({
  harness,
  headless,
  lane,
  launchOptions,
  locale,
  outputDir,
  repeat,
  runSet,
  runtime,
  settings,
  taskId,
}: {
  readonly harness: AgentEvalHarness;
  readonly headless: boolean;
  readonly lane: { readonly lane: number; readonly lanes: number };
  readonly launchOptions: LaunchOptions;
  readonly locale: Locale;
  /** The test's own directory; the harness gets it for traces. */
  readonly outputDir: string;
  readonly repeat: number;
  readonly runSet: AgentEvalRunSet;
  readonly runtime: AgentEvalRuntime;
  readonly settings: AgentEvalSettings;
  readonly taskId: AgentEvalTaskId;
}): Promise<AgentEvalRunResult> => {
  const { config, datasourceConfig } = settings;
  const runId = makeAgentEvalRunId();
  const owner = agentEvalJournalOwner(runSet.runSetId, runId);
  const recorder = makeWorkspaceE2EAccountJournalRecorder(
    owner.ownerId,
    owner.journalDirectory
  );
  const email = makeWorkspaceE2EAccountRecipientForRunId(
    runId,
    agentEvalRecipientLabel
  );
  const accountId = customerAccountIdSchema.make(
    `agent-eval-${crypto.randomUUID()}`
  );
  const startUrl = `${config.baseUrl}/${locale}`;
  let browser: Awaited<ReturnType<typeof launchAgentEvalBrowser>> | undefined;

  try {
    const parameters = await runtime.runPromise(
      selectAgentEvalTaskParameters(taskId, config, lane)
    );

    // Journal every identity before it exists, or right after the provider
    // assigns its id, so cleanup can always find it.
    await recorder.record({ authUserIds: [accountId] });
    const customerId = await runtime.runPromise(
      createSyntheticCustomerProfile(datasourceConfig, {
        email,
        firstName: "Agent",
      })
    );
    await recorder.record({ dotyposCustomerIds: [customerId] });
    await runtime.runPromise(
      seedWorkspaceE2ESyntheticAccount({
        accountId,
        email,
        linkedCustomerId: customerId,
        name: "Workspace E2E agent",
      })
    );

    browser = await launchAgentEvalBrowser({ headless, launchOptions, locale });
    const { context } = browser;
    await runtime.runPromise(
      primePreviewBypass({
        bypassSecret: config.bypassSecret,
        context,
        origin: config.baseUrl,
      })
    );
    await runtime.runPromise(
      signInWorkspaceE2ESyntheticBrowserContext({
        accountId,
        context,
        origin: config.baseUrl,
        secret: resolveWorkspaceE2ESessionSigningSecret(settings.environment),
      })
    );
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(startUrl, {
      timeout: workspaceE2ETimeouts.browserNavigation,
      waitUntil: "load",
    });

    await mkdir(outputDir, { recursive: true });
    const budgetMs = agentEvalTaskBudgetMs(taskId);
    const request: AgentEvalRequest = {
      cdpEndpoint: browser.cdpEndpoint,
      locale,
      outputDir,
      prompt: makeAgentEvalPrompt(parameters, locale, startUrl),
      startUrl,
      taskId,
      timeoutMs: budgetMs,
      version: 1,
    };
    const startedAt = new Date().toISOString();
    const observer = await observeAgentEvalBrowser(context, page, {
      paymentProviderHost: new URL(datasourceConfig.nexiApiOrigin).hostname,
      siteOrigin: config.baseUrl,
    });
    const harnessStartedAt = performance.now();
    const harnessRun = await runtime.runPromise(
      runAgentEvalHarness({
        harness,
        harnessDirectory: settings.harnessDirectory,
        killAfterMs: budgetMs + workspaceAgentEvalTimeouts.harnessExitGrace,
        request,
      })
    );
    const wallTimeMs = Math.round(performance.now() - harnessStartedAt);
    const observations = observer.snapshot();
    await writeFile(
      resolve(outputDir, "harness-stderr.log"),
      harnessRun.stderr,
      {
        encoding: "utf8",
        mode: 0o600,
      }
    );

    const reservationIds = await runtime.runPromise(
      readAgentEvalReservationIds(accountId, customerId)
    );
    await recorder.record({ dotyposReservationIds: reservationIds });

    let judgement: AgentEvalJudgement;
    if (parameters.taskId === "facts") {
      judgement = judgeAgentEvalFacts(harnessRun.response?.finalAnswer ?? "");
    } else {
      const records = await runtime.runPromise(
        readAgentEvalReservations(datasourceConfig, accountId)
      );
      const statusPage =
        parameters.taskId === "open-space-payment"
          ? await checkStatusPage(context, observations.statusPageUrl)
          : undefined;
      judgement = judgeAgentEvalReservation(parameters, records, statusPage);
    }

    const result: AgentEvalRunResult = {
      costUsd: harnessRun.response?.costUsd ?? null,
      failureCategory: classifyAgentEvalFailure({
        harnessOutcome: harnessRun.outcome,
        judgement,
        observations,
        taskId,
      }),
      finalAnswer: truncate(harnessRun.response?.finalAnswer, 2_000),
      harnessError: truncate(harnessRun.response?.error, 500),
      harnessId: harness.id,
      harnessOutcome: harnessRun.outcome,
      locale,
      missingFacts: judgement.missingFacts ?? null,
      paymentPage: observations.paymentPage,
      perception: harness.perception,
      reason: judgement.reason,
      repeat,
      routes: observations.routes,
      runSetId: runSet.runSetId,
      startedAt,
      steps: harnessRun.response?.steps ?? null,
      success: judgement.success,
      tabCount: observations.tabCount,
      taskId,
      timeToPayUrlMs: observations.timeToPayUrlMs,
      version: 1,
      wallTimeMs,
    };
    await writeAgentEvalRunResult(result);
    return result;
  } finally {
    try {
      await browser?.close();
    } finally {
      await runtime.runPromise(
        reconcileAgentEvalRun(datasourceConfig, runSet.runSetId, runId)
      );
    }
  }
};
