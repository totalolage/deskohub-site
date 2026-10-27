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
  type WorkspaceE2EAccountJournal,
  writeWorkspaceE2EAccountJournal,
} from "../account/journal";
import { workspaceE2EAccountProfileFixture } from "../account/profile-fixture";
import {
  prepareWorkspaceE2EAccountJournalReconciliations,
  reconcileWorkspaceE2EAccountJournals,
  type WorkspaceE2EAccountJournalOwner,
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
import { type AgentEvalBrowser, launchAgentEvalBrowser } from "./browser";
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
  type AgentEvalRunResources,
  proveAgentEvalRunOwnership,
  readAgentEvalPaymentLedgerReservationIds,
  readAgentEvalReservations,
  readAgentEvalRunResources,
} from "./records";
import { redactAgentEvalOutput, redactAgentEvalValue } from "./redaction";
import type { AgentEvalRunResult } from "./results";
import {
  type AgentEvalJudgeInput,
  type AgentEvalRunSet,
  agentEvalJournalDirectory,
  writeAgentEvalJudgeInput,
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

const agentEvalJournalOwner = (runSetId: string, runId: string) =>
  ({
    journalDirectory: agentEvalJournalDirectory(runSetId),
    ownerId: runId,
    proveOwnership: proveAgentEvalRunOwnership,
    recipientLabels: [agentEvalRecipientLabel],
  }) satisfies WorkspaceE2EAccountJournalOwner;

/** A short opaque id; the synthetic recipient's local part derives from it. */
const makeAgentEvalRunId = () =>
  Schema.decodeSync(workspaceE2ERunIdSchema)(
    `ae-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`
  );

/**
 * Cancels the run's reservations, expires its Dotypos profiles, and deletes
 * its account, by the journal. Reservations the account authored after the
 * journal last changed, for any contact, and contact profiles Dotypos
 * created during the run are added first, so an interrupted run still cleans
 * up. Authorship proves the run owns another contact's resources.
 * Idempotent, so suite teardown repeats it for every journal.
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
    if (accountId) {
      const resources = yield* readAgentEvalRunResources(
        datasourceConfig,
        accountId,
        journal.startedAt
      );
      const merged = mergeAgentEvalRunResources(journal, resources);
      if (merged !== journal) {
        yield* tryWorkspaceE2EPromise("journal agent eval reservations", () =>
          writeWorkspaceE2EAccountJournal(merged, owner.journalDirectory)
        );
      }
    }
    const prepared = yield* prepareWorkspaceE2EAccountJournalReconciliations(
      datasourceConfig,
      runId,
      [owner]
    );
    // The journal's reservation ids are the rows reconciliation deletes; its
    // candidates are the ones it cancels in Dotypos. A reservation that
    // reached payment is cancelled but keeps its payment ledger rows.
    const retained = yield* readAgentEvalPaymentLedgerReservationIds(
      prepared.flatMap((entry) => entry.journal.dotyposReservationIds)
    );
    yield* reconcileWorkspaceE2EAccountJournals(
      prepared.map((entry) => ({
        ...entry,
        journal: {
          ...entry.journal,
          dotyposReservationIds: entry.journal.dotyposReservationIds.filter(
            (id) => !retained.includes(id)
          ),
        },
      }))
    );
  }
);

/** The journal with the run's resources added; the same journal when none is new. */
const mergeAgentEvalRunResources = (
  journal: WorkspaceE2EAccountJournal,
  resources: AgentEvalRunResources
): WorkspaceE2EAccountJournal => {
  const added = (existing: readonly string[], found: readonly string[]) =>
    found.filter((id) => !existing.includes(id));
  const reservationIds = added(
    journal.dotyposReservationIds,
    resources.dotyposReservationIds
  );
  const customerIds = added(
    journal.dotyposCustomerIds,
    resources.dotyposCustomerIds
  );
  return reservationIds.length === 0 && customerIds.length === 0
    ? journal
    : {
        ...journal,
        dotyposCustomerIds: [...journal.dotyposCustomerIds, ...customerIds],
        dotyposReservationIds: [
          ...journal.dotyposReservationIds,
          ...reservationIds,
        ],
      };
};

const redactAndTruncate = (
  value: string | undefined,
  length: number,
  identifiers: readonly string[]
) =>
  value === undefined
    ? null
    : redactAgentEvalOutput(value, identifiers).slice(0, length);

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
  let browser: AgentEvalBrowser | undefined;
  if (runSet.target.sha !== settings.targetSha) {
    throw new Error(
      "The run set's verified preview was not built from TARGET_SHA; rerun the setup project"
    );
  }

  try {
    const parameters = await runtime.runPromise(
      selectAgentEvalTaskParameters(taskId, config, lane)
    );

    // Journal every identity before it exists, or right after the provider
    // assigns its id, so cleanup can always find it. The profile is a
    // returning customer's: checkout asks for nothing the prompt can't give.
    await recorder.record({ authUserIds: [accountId] });
    const customerId = await runtime.runPromise(
      createSyntheticCustomerProfile(datasourceConfig, {
        email,
        firstName: workspaceE2EAccountProfileFixture.firstName,
        phone: workspaceE2EAccountProfileFixture.phone,
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

    browser = await runtime.runPromise(
      launchAgentEvalBrowser({ headless, launchOptions, locale })
    );
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

    const resources = await runtime.runPromise(
      readAgentEvalRunResources(
        datasourceConfig,
        accountId,
        recorder.journal.startedAt
      )
    );
    await recorder.record({
      dotyposCustomerIds: resources.dotyposCustomerIds,
      dotyposReservationIds: resources.dotyposReservationIds,
    });
    const identifiers = [runId, email, customerId, ...resources.identifiers];
    await writeFile(
      resolve(outputDir, "harness-stderr.log"),
      redactAgentEvalOutput(harnessRun.stderr, identifiers),
      {
        encoding: "utf8",
        mode: 0o600,
      }
    );

    let judgement: AgentEvalJudgement;
    let judgeInput: AgentEvalJudgeInput;
    if (parameters.taskId === "facts") {
      const finalAnswer = harnessRun.response?.finalAnswer ?? "";
      judgement = judgeAgentEvalFacts(finalAnswer);
      judgeInput = { finalAnswer, parameters };
    } else {
      const records = await runtime.runPromise(
        readAgentEvalReservations(datasourceConfig, accountId)
      );
      const statusPage =
        parameters.taskId === "open-space-payment"
          ? await checkStatusPage(context, observations.statusPageUrl)
          : undefined;
      judgement = judgeAgentEvalReservation(parameters, records, statusPage);
      judgeInput = { parameters, records, statusPage: statusPage ?? null };
    }

    const result: AgentEvalRunResult = {
      costUsd: harnessRun.response?.costUsd ?? null,
      failureCategory: classifyAgentEvalFailure({
        harnessOutcome: harnessRun.outcome,
        judgement,
        observations,
        taskId,
      }),
      finalAnswer: redactAndTruncate(
        harnessRun.response?.finalAnswer,
        2_000,
        identifiers
      ),
      harnessError: redactAndTruncate(
        harnessRun.response?.error,
        500,
        identifiers
      ),
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
    await writeAgentEvalJudgeInput(
      result,
      redactAgentEvalValue(judgeInput, identifiers)
    );
    return result;
  } finally {
    try {
      if (browser) await runtime.runPromise(browser.close);
    } finally {
      await runtime.runPromise(
        reconcileAgentEvalRun(datasourceConfig, runSet.runSetId, runId)
      );
    }
  }
};
