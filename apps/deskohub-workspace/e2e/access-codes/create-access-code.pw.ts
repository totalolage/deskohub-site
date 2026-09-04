import { AssertionError } from "node:assert";
import { deepStrictEqual, equal, ok } from "node:assert/strict";
import {
  type BrowserContext,
  expect,
  type Page,
  type Request,
} from "@playwright/test";
import { Cause, Effect, Exit, Option } from "effect";
import type { AdministrationStandaloneAccessCodeName } from "@deskohub/workspace-admin-api";
import { eq } from "drizzle-orm";
import { makeWorkspaceE2EAdminCredential } from "../admin-basic-auth";
import { toWorkspaceE2EError, WorkspaceE2EError, workspaceE2EError } from "../errors";
import { writeWorkspaceE2EFailureAnnotation } from "../github-actions";
import { E2EDatabase } from "../integrations/database.service";
import { pollUntil, withinWorkspaceE2EDeadline } from "../polling";
import { runtimeTest as test } from "../playwright-checkout/runtime-fixtures";
import { addRedaction } from "../runtime";
import { E2ETelemetryService, toE2EResult } from "../services/telemetry";
import type { WorkspaceE2EFailureReporter } from "../suite";
import {
  workspaceE2EAccessCodeCleanupTimeout,
  workspaceE2EPollIntervalMs,
  workspaceE2ETimeouts,
} from "../timeouts";
import type { DatabaseClient } from "@/db/database-client";
import { standaloneAccessCodeAttemptEvents } from "@/db/schema";
import {
  type AccessCodeCreationPlan,
  type ActionResponseOutcome,
  awaitActionQuiescence,
  makeSyntheticAccessCodeName,
  planAccessCodeCreationAttempt,
  runFinalizedCase,
  sanitizedBrowserOperation,
  sanitizedBrowserFailure,
  selectActionReplayHeaders,
} from "./access-code-case";

const accessCodeCreationCaseId = "access-code-creation";
const editingFormSelector =
  'form[data-standalone-access-code-creation="editing"]';
const createdRegionSelector = '[data-standalone-access-code-creation="created"]';
const fixturePin = "1111111";
const fixturePinDigitsLabel = "1 1 1 1 1 1 1";

interface CapturedActionRequest {
  readonly body: Buffer;
  readonly headers: Record<string, string>;
  readonly url: string;
}

test(
  "creates a standalone access code through the admin form and replays the same attempt idempotently",
  async ({ baseURL, browser, environment, runContext, runEffect }) => {
    const credential = makeWorkspaceE2EAdminCredential(
      environment.WORKSPACE_E2E_ADMIN_BASIC_AUTH
    );
    addRedaction(environment.VERCEL_AUTOMATION_BYPASS_SECRET);
    if (!baseURL) {
      throw workspaceE2EError(
        "Playwright baseURL is required for the access code creation case",
        { operation: "start the access code creation case" }
      );
    }
    const origin = new URL(baseURL).origin;
    const plan = planAccessCodeCreationAttempt({
      name: makeSyntheticAccessCodeName(),
    });
    let context: BrowserContext;
    try {
      context = await browser.newContext({
        baseURL,
        httpCredentials: {
          origin,
          password: credential.password,
          send: "always",
          username: credential.username,
        },
        viewport: { height: 900, width: 1440 },
      });
    } catch {
      throw sanitizedBrowserFailure(
        "start the access code creation browser context"
      )();
    }
    const page = await context
      .newPage()
      .catch(() => {
        throw sanitizedBrowserFailure(
          "open the access code creation page"
        )();
      });
    try {
      await runEffect(
        runAccessCodeCreationCase({
          actorUsername: credential.username,
          bypassSecret: environment.VERCEL_AUTOMATION_BYPASS_SECRET,
          context,
          origin,
          page,
          plan,
          reportFailure:
            runContext.githubRunId === undefined
              ? undefined
              : writeWorkspaceE2EFailureAnnotation,
        })
      );
    } finally {
      await context.close().catch(() => undefined);
    }
  }
);

const runAccessCodeCreationCase = (input: {
  readonly actorUsername: string;
  readonly bypassSecret: string | undefined;
  readonly context: BrowserContext;
  readonly origin: string;
  readonly page: Page;
  readonly plan: AccessCodeCreationPlan;
  readonly reportFailure?: WorkspaceE2EFailureReporter;
}) =>
  Effect.gen(function* () {
    const telemetry = yield* E2ETelemetryService;
    const { db } = yield* E2EDatabase;
    const cleanup = cleanupSyntheticAttemptEvents(db, input.plan.name);
    // Registered before the submit click so cleanup waits on the action even
    // when the submit operation is interrupted before returning its capture.
    let actionBarrier: Promise<ActionResponseOutcome> | undefined;
    // The replay is a second mutation; its barrier is registered synchronously
    // before the POST is awaited, so an interrupted replay still gates cleanup.
    let replayBarrier: Promise<ActionResponseOutcome> | undefined;
    let capturedAction: CapturedActionRequest | undefined;
    let terminalStepId: string | undefined;

    const step = (
      stepId: string,
      timeoutMs: number,
      execute: Effect.Effect<void, WorkspaceE2EError>
    ) => {
      const operation = `${accessCodeCreationCaseId}/${stepId}`;
      return telemetry.traceStep({
        caseId: accessCodeCreationCaseId,
        effect: Effect.onExit(
          withinWorkspaceE2EDeadline(execute, operation, timeoutMs),
          (exit) =>
            Effect.sync(() => {
              if (toE2EResult(exit).outcome !== "passed") {
                terminalStepId = stepId;
              }
            })
        ),
        stepId,
        timeoutMs,
      });
    };

    const waitForTerminalEvent = pollUntil(
      readSyntheticAttemptEvents(db, input.plan.name).pipe(
        Effect.map((rows) =>
          rows.some((row) => row.eventKind !== "started") ? true : undefined
        )
      ),
      {
        intervalMs: workspaceE2EPollIntervalMs.datasource,
        label: "the standalone access code terminal event",
        timeoutMs: workspaceE2ETimeouts.accessCodeStaleBarrier,
      }
    );

    const timedBody = withinWorkspaceE2EDeadline(
      Effect.gen(function* () {
            yield* step(
              "clean-synthetic-rows",
              workspaceE2ETimeouts.cleanupAction,
              cleanup
            );
            yield* step(
              "prime-preview-bypass",
              workspaceE2ETimeouts.browserAction,
              primePreviewBypass({
                bypassSecret: input.bypassSecret,
                context: input.context,
                origin: input.origin,
              })
            );
            yield* step(
              "open-admin-form",
              workspaceE2ETimeouts.browserNavigation,
              sanitizedBrowserOperation("open the access-code admin page", () =>
                input.page
                  .goto(`${input.origin}/admin/access-codes`, {
                    timeout: workspaceE2ETimeouts.browserNavigation,
                  })
                  .then(() => undefined)
              )
            );
            yield* step(
              "wait-for-admin-form",
              workspaceE2ETimeouts.browserAction,
              sanitizedBrowserOperation("wait for the create access code form", () =>
                input.page.locator(editingFormSelector).waitFor({
                  state: "visible",
                  timeout: workspaceE2ETimeouts.browserAction,
                })
              )
            );
            yield* step(
              "wait-for-form-hydration",
              workspaceE2ETimeouts.uiTransition,
              sanitizedBrowserOperation(
                "wait for the hydrated create access code form handler",
                () =>
                  input.page.waitForFunction(
                    ([selector]) => {
                      const form = document.querySelector(selector);
                      if (!form) return false;
                      const propsKey = Object.keys(form).find((key) =>
                        key.startsWith("__reactProps$")
                      );
                      const props =
                        propsKey === undefined
                          ? undefined
                          : (form as unknown as Record<string, unknown>)[
                              propsKey
                            ];
                      return (
                        typeof (props as { onSubmit?: unknown } | undefined)
                          ?.onSubmit === "function"
                      );
                    },
                    [editingFormSelector] as const,
                    { timeout: workspaceE2ETimeouts.uiTransition }
                  )
              )
            );
            yield* step(
              "fill-access-code-name",
              workspaceE2ETimeouts.browserAction,
              sanitizedBrowserOperation("fill the access code name", () =>
                input.page
                  .getByLabel("Name", { exact: true })
                  .fill(input.plan.name, {
                    timeout: workspaceE2ETimeouts.browserAction,
                  })
              )
            );
            yield* step(
              "fill-window-start",
              workspaceE2ETimeouts.browserAction,
              sanitizedBrowserOperation("fill the access window start", () =>
                input.page
                  .getByLabel("Starts", { exact: true })
                  .fill(input.plan.startsAtLocal, {
                    timeout: workspaceE2ETimeouts.browserAction,
                  })
              )
            );
            yield* step(
              "fill-window-end",
              workspaceE2ETimeouts.browserAction,
              sanitizedBrowserOperation("fill the access window end", () =>
                input.page
                  .getByLabel("Ends", { exact: true })
                  .fill(input.plan.endsAtLocal, {
                    timeout: workspaceE2ETimeouts.browserAction,
                  })
              )
            );
            yield* step(
              "assert-duration-preview",
              workspaceE2ETimeouts.browserAction,
              sanitizedBrowserOperation(
                "wait for the hydrated window duration preview",
                () =>
                  expect(
                    input.page.getByText(/^Duration: \d+ hours?$/)
                  ).toBeVisible({ timeout: workspaceE2ETimeouts.browserAction })
              )
            );
            yield* step(
              "submit-creation",
              workspaceE2ETimeouts.uiTransition,
              Effect.gen(function* () {
                const actionRequest = yield* sanitizedBrowserOperation(
                  "activate the create access code submit control once and capture its server action request",
                  async () => {
                    const isActionRequest = (request: Request) =>
                      request.method() === "POST" &&
                      request.url().startsWith(input.origin) &&
                      request.headers()["next-action"] !== undefined;
                    const requestPromise = input.page.waitForRequest(
                      isActionRequest,
                      { timeout: workspaceE2ETimeouts.uiTransition }
                    );
                    const responsePromise = input.page.waitForResponse(
                      (response) => isActionRequest(response.request()),
                      { timeout: workspaceE2ETimeouts.providerTransition }
                    );
                    // The mutation route keeps running after disconnects, so
                    // the retained settled response is the completion barrier
                    // cleanup waits on before deleting synthetic rows. It is
                    // registered in outer case state before the click, so an
                    // interrupted submit still leaves the barrier behind.
                    const responseSettled = responsePromise.then(
                      (): ActionResponseOutcome => ({ kind: "responded" }),
                      (): ActionResponseOutcome => ({ kind: "unresolved" })
                    );
                    actionBarrier = responseSettled;
                    try {
                      await input.page
                        .getByRole("button", {
                          name: "Create access code",
                          exact: true,
                        })
                        .click({
                          timeout: workspaceE2ETimeouts.browserAction,
                        });
                      return await requestPromise;
                    } catch (cause) {
                      void requestPromise.catch(() => undefined);
                      void responsePromise.catch(() => undefined);
                      throw cause;
                    }
                  }
                );
                const body = actionRequest.postDataBuffer();
                if (!body) {
                  return yield* workspaceE2EError(
                    "The captured create access code server action request has no body",
                    {
                      operation:
                        "capture the create access code server action request",
                    }
                  );
                }
                capturedAction = {
                  body,
                  headers: actionRequest.headers(),
                  url: actionRequest.url(),
                };
              })
            );
            yield* step(
              "wait-for-created-confirmation",
              workspaceE2ETimeouts.uiTransition,
              sanitizedBrowserOperation(
                "wait for the created access code confirmation",
                () =>
                  expect(
                    input.page.locator(createdRegionSelector)
                  ).toBeVisible({ timeout: workspaceE2ETimeouts.uiTransition })
              )
            );
            yield* step(
              "assert-fixture-pin-output",
              workspaceE2ETimeouts.browserAction,
              sanitizedBrowserOperation(
                "assert the one-time fixture PIN output",
                () =>
                  expect(
                    input.page
                      .locator(createdRegionSelector)
                      .getByRole("status")
                  ).toHaveAttribute("aria-label", fixturePinDigitsLabel, {
                    timeout: workspaceE2ETimeouts.browserAction,
                  })
              )
            );
            yield* step(
              "assert-created-summary",
              workspaceE2ETimeouts.browserAction,
              sanitizedBrowserOperation(
                "assert the created access code summary",
                () =>
                  expect(
                    input.page.locator(createdRegionSelector)
                  ).toContainText(input.plan.name, {
                    timeout: workspaceE2ETimeouts.browserAction,
                  })
              )
            );
            yield* step(
              "replay-deployed-action",
              workspaceE2ETimeouts.providerTransition,
              Effect.gen(function* () {
                if (!capturedAction) {
                  return yield* workspaceE2EError(
                    "No captured create access code server action request is available for the replay",
                    {
                      operation:
                        "replay the deployed create access code action",
                    }
                  );
                }
                const action = capturedAction;
                const replayResponsePromise = input.context.request.post(
                  action.url,
                  {
                    data: action.body,
                    headers: selectActionReplayHeaders(action.headers),
                    timeout: workspaceE2ETimeouts.providerTransition,
                  }
                );
                const replaySettled = replayResponsePromise.then(
                  (): ActionResponseOutcome => ({ kind: "responded" }),
                  (): ActionResponseOutcome => ({ kind: "unresolved" })
                );
                replayBarrier = replaySettled;
                yield* sanitizedBrowserOperation(
                  "replay the captured create access code server action request",
                  async () => {
                    const response = await replayResponsePromise;
                    try {
                      equal(response.status(), 200);
                      const body = await response.text();
                      ok(
                        body.includes("already-created"),
                        "the replayed attempt must return the already-created outcome"
                      );
                      ok(
                        !body.includes('"outcome":"created"'),
                        "the replayed attempt must not report a fresh creation"
                      );
                      ok(
                        !body.includes(fixturePin),
                        "the replayed attempt must not re-disclose the one-time PIN"
                      );
                    } finally {
                      await response.dispose();
                    }
                  }
                );
              })
            );
            yield* step(
              "assert-attempt-persistence",
              workspaceE2ETimeouts.datasource,
              Effect.gen(function* () {
                const events = yield* pollUntil(
                  readSyntheticAttemptEvents(db, input.plan.name).pipe(
                    Effect.map((rows) => (rows.length === 2 ? rows : undefined))
                  ),
                  {
                    intervalMs: workspaceE2EPollIntervalMs.datasource,
                    label: "the standalone access code attempt events",
                    timeoutMs: workspaceE2ETimeouts.datasource,
                  }
                );
                equal(events.length, 2);
                deepStrictEqual(
                  events.map((row) => row.eventKind).sort(),
                  ["created", "started"]
                );
                const started = events.find(
                  (row) => row.eventKind === "started"
                );
                const created = events.find(
                  (row) => row.eventKind === "created"
                );
                ok(started && created);
                const attemptIds = new Set(
                  events.map((row) => row.attemptId)
                );
                equal(attemptIds.size, 1);
                const [attemptId] = attemptIds;
                ok(
                  typeof attemptId === "string" &&
                    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
                      attemptId
                    ),
                  "both attempt events must share one valid form-generated attempt id"
                );
                ok(
                  events.every(
                    (row) => row.startsAtLocal === input.plan.startsAtLocal
                  ) &&
                    events.every(
                      (row) => row.endsAtLocal === input.plan.endsAtLocal
                    ),
                  "the persisted access window must match the submitted plan"
                );
                equal(created.providerCredentialId, `fixture-${input.plan.name}`);
                ok(
                  created.variance === 2 || created.variance === 3,
                  "the created event must record a supported provider variance"
                );
                equal(created.variance, started.variance);
                equal(started.providerCredentialId, null);
                ok(events.every((row) => row.source === "admin-ui"));
                ok(events.every((row) => row.actor === input.actorUsername));
                ok(events.every((row) => row.name === input.plan.name));
              })
            );
        }),
        `${accessCodeCreationCaseId} e2e case`,
        workspaceE2ETimeouts.accessCodeCase
      );

    const finalized = runFinalizedCase({
      body: timedBody,
      cleanup: withinWorkspaceE2EDeadline(
        Effect.gen(function* () {
          yield* awaitActionQuiescence({
            barrierTimeoutMs: workspaceE2ETimeouts.accessCodeActionBarrier,
            label: "initial access code action",
            responseSettled: actionBarrier,
            waitForTerminalEvent,
          });
          yield* awaitActionQuiescence({
            barrierTimeoutMs: workspaceE2ETimeouts.accessCodeActionBarrier,
            label: "replayed access code action",
            responseSettled: replayBarrier,
          });
          yield* cleanup;
        }),
        `${accessCodeCreationCaseId}/cleanup`,
        workspaceE2EAccessCodeCleanupTimeout
      ).pipe(Effect.orDie),
      trace: (effect) =>
        telemetry.traceCase({
          caseId: accessCodeCreationCaseId,
          effect,
          timeoutMs: workspaceE2ETimeouts.accessCodeCase,
        }),
      onExit: (exit) => {
        if (Exit.isSuccess(exit) || !input.reportFailure) return;
        if (Cause.hasInterruptsOnly(exit.cause)) return;
        const result = toE2EResult(exit);
        if (result.outcome !== "failed" && result.outcome !== "timed_out") {
          return;
        }
        const error = Cause.findErrorOption(exit.cause);
        try {
          input.reportFailure({
            caseId: accessCodeCreationCaseId,
            ...(Option.isSome(error) &&
            error.value instanceof WorkspaceE2EError &&
            error.value.diagnosticCode
              ? { diagnosticCode: error.value.diagnosticCode }
              : {}),
            failureKind: result.failureKind,
            outcome: result.outcome,
            ...(terminalStepId ? { stepId: terminalStepId } : {}),
          });
        } catch {
          // The annotation must never mask the case outcome.
        }
      },
    });

    yield* finalized;
  });

const primePreviewBypass = (input: {
  readonly bypassSecret: string | undefined;
  readonly context: BrowserContext;
  readonly origin: string;
}) => {
  const bypassSecret = input.bypassSecret;
  if (!bypassSecret) return Effect.void;
  return sanitizedBrowserOperation(
    "prime the Vercel protection bypass cookie",
    async () => {
      const response = await input.context.request.get(
        new URL("/favicon.svg", input.origin).toString(),
        {
          headers: {
            "x-vercel-protection-bypass": bypassSecret,
            "x-vercel-set-bypass-cookie": "true",
          },
          timeout: workspaceE2ETimeouts.browserAction,
        }
      );
      try {
        if (!response.ok()) {
          throw new Error(
            `The Vercel protection bypass probe failed with ${response.status()}`
          );
        }
      } finally {
        await response.dispose();
      }
    }
  );
};

const readSyntheticAttemptEvents = (
  db: DatabaseClient,
  name: AdministrationStandaloneAccessCodeName
) =>
  db
    .select()
    .from(standaloneAccessCodeAttemptEvents)
    .where(eq(standaloneAccessCodeAttemptEvents.name, name))
    .pipe(
      Effect.mapError((cause) =>
        toWorkspaceE2EError("read synthetic access code attempt events", cause)
      )
    );

const cleanupSyntheticAttemptEvents = (
  db: DatabaseClient,
  name: AdministrationStandaloneAccessCodeName
) =>
  Effect.gen(function* () {
    yield* db
      .delete(standaloneAccessCodeAttemptEvents)
      .where(eq(standaloneAccessCodeAttemptEvents.name, name))
      .pipe(
        Effect.mapError((cause) =>
          toWorkspaceE2EError(
            "delete synthetic access code attempt events",
            cause
          )
        )
      );
    const remaining = yield* db
      .select({ id: standaloneAccessCodeAttemptEvents.id })
      .from(standaloneAccessCodeAttemptEvents)
      .where(eq(standaloneAccessCodeAttemptEvents.name, name))
      .pipe(
        Effect.mapError((cause) =>
          toWorkspaceE2EError(
            "verify synthetic access code attempt cleanup",
            cause
          )
        )
      );
    equal(remaining.length, 0);
  });
