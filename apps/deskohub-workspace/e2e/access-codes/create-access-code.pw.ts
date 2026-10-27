import { deepStrictEqual, equal, ok } from "node:assert/strict";
import type { AdministrationStandaloneAccessCodeName } from "@deskohub/workspace-admin-api";
import { expect, type Request } from "@playwright/test";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import type { DatabaseClient } from "@/db/database-client";
import { standaloneAccessCodeAttemptEvents } from "@/db/schema";
import { resolveWorkspaceE2ESessionSigningSecret } from "../account/seeded-session";
import {
  type ActionResponseOutcome,
  awaitActionQuiescence,
  openAdminSession,
} from "../admin-case";
import {
  makeWorkspaceE2EAdministrationIdentities,
  type WorkspaceE2EAdministrationAccount,
  type WorkspaceE2EAdministrationIdentities,
} from "../administrators/identities";
import type { E2EBrowserSession } from "../browser-session";
import { runE2ECase, type WorkspaceE2EStepRunner } from "../case-runner";
import { toWorkspaceE2EError, workspaceE2EError } from "../errors";
import { E2EDatabase } from "../integrations/database.service";
import { runtimeTest as test } from "../playwright-checkout/runtime-fixtures";
import { pollUntil, withinWorkspaceE2EDeadline } from "../polling";
import { waitForReactSubmitHandler } from "../react-handlers";
import { addRedaction } from "../runtime";
import {
  workspaceE2EAccessCodeCleanupTimeout,
  workspaceE2EPollInitialIntervalMs,
  workspaceE2EPollIntervalMs,
  workspaceE2ETimeouts,
} from "../timeouts";
import {
  type AccessCodeCreationPlan,
  makeSyntheticAccessCodeName,
  planAccessCodeCreationAttempt,
  selectActionReplayHeaders,
} from "./access-code-case";

const accessCodeCreationCaseId = "access-code-creation";
const editingFormSelector =
  'form[data-standalone-access-code-creation="editing"]';
const createdRegionSelector =
  '[data-standalone-access-code-creation="created"]';
const fixturePin = "1111111";
const fixturePinDigitsLabel = "1 1 1 1 1 1 1";

interface CapturedActionRequest {
  readonly body: Buffer;
  readonly headers: Record<string, string>;
  readonly url: string;
}

test("creates a standalone access code through the admin form and replays the same attempt idempotently", async ({
  baseURL,
  browser,
  environment,
  runContext,
  runEffect,
}) => {
  const identities = makeWorkspaceE2EAdministrationIdentities<"acc-admin">({
    ownerId: accessCodeCreationCaseId,
    runId: runContext.runId,
    secret: resolveWorkspaceE2ESessionSigningSecret(environment),
  });
  addRedaction(environment.VERCEL_AUTOMATION_BYPASS_SECRET);
  const plan = planAccessCodeCreationAttempt({
    name: makeSyntheticAccessCodeName(),
  });
  await runEffect(
    Effect.scoped(
      Effect.flatMap(
        openAdminSession({
          baseURL,
          browser,
          caseName: "access code creation",
        }),
        ({ origin, session }) =>
          runAccessCodeCreationCase({
            bypassSecret: environment.VERCEL_AUTOMATION_BYPASS_SECRET,
            identities,
            origin,
            plan,
            session,
          })
      )
    )
  );
});

const runAccessCodeCreationCase = Effect.fn("runAccessCodeCreationCase")(
  function* (input: {
    readonly bypassSecret: string | undefined;
    readonly identities: WorkspaceE2EAdministrationIdentities<"acc-admin">;
    readonly origin: string;
    readonly plan: AccessCodeCreationPlan;
    readonly session: E2EBrowserSession;
  }) {
    const { db } = yield* E2EDatabase;
    const cleanup = cleanupSyntheticAttemptEvents(db, input.plan.name);
    // Registered before the submit click so cleanup waits on the action even
    // when the submit operation is interrupted before returning its capture.
    let actionBarrier: Promise<ActionResponseOutcome> | undefined;
    // The replay is a second mutation; its barrier is registered synchronously
    // before the POST is awaited, so an interrupted replay still gates cleanup.
    let replayBarrier: Promise<ActionResponseOutcome> | undefined;
    let capturedAction: CapturedActionRequest | undefined;
    let administrator: WorkspaceE2EAdministrationAccount | undefined;

    const waitForTerminalEvent = pollUntil(
      readSyntheticAttemptEvents(db, input.plan.name).pipe(
        Effect.map((rows) =>
          rows.some((row) => row.eventKind !== "started") ? true : undefined
        )
      ),
      {
        initialIntervalMs: workspaceE2EPollInitialIntervalMs.database,
        intervalMs: workspaceE2EPollIntervalMs.datasource,
        label: "the standalone access code terminal event",
        timeoutMs: workspaceE2ETimeouts.accessCodeStaleBarrier,
      }
    );

    const caseBody = Effect.fn(function* (step: WorkspaceE2EStepRunner) {
      yield* step({
        execute: cleanup,
        id: "clean-synthetic-rows",
        timeoutMs: workspaceE2ETimeouts.cleanupAction,
      });
      yield* step({
        execute: input.session.primePreviewAccess(
          input.origin,
          input.bypassSecret,
          { timeoutMs: workspaceE2ETimeouts.browserAction }
        ),
        id: "prime-preview-bypass",
        timeoutMs: workspaceE2ETimeouts.browserAction,
      });
      yield* step({
        execute: Effect.gen(function* () {
          administrator = yield* input.identities.seed("acc-admin", [
            "administrator",
          ]);
          yield* input.identities.signIn(administrator, input);
        }).pipe(Effect.provideService(E2EDatabase, E2EDatabase.of({ db }))),
        id: "sign-in-seeded-administrator",
        timeoutMs: workspaceE2ETimeouts.datasource,
      });
      yield* step({
        execute: input.session.use("open the access-code admin page", (page) =>
          page
            .goto(`${input.origin}/en-US/admin/access-codes`, {
              timeout: workspaceE2ETimeouts.browserNavigation,
            })
            .then(() => undefined)
        ),
        id: "open-admin-form",
        timeoutMs: workspaceE2ETimeouts.browserNavigation,
      });
      yield* step({
        execute: input.session.use(
          "wait for the create access code form",
          (page) =>
            page.locator(editingFormSelector).waitFor({
              state: "visible",
              timeout: workspaceE2ETimeouts.browserAction,
            })
        ),
        id: "wait-for-admin-form",
        timeoutMs: workspaceE2ETimeouts.browserAction,
      });
      yield* step({
        execute: input.session.use(
          "wait for the hydrated create access code form handler",
          (page) =>
            waitForReactSubmitHandler(
              page,
              page.locator(editingFormSelector),
              workspaceE2ETimeouts.uiTransition
            )
        ),
        id: "wait-for-form-hydration",
        timeoutMs: workspaceE2ETimeouts.uiTransition,
      });
      yield* step({
        execute: input.session.use("fill the access code name", (page) =>
          page.getByLabel("Name", { exact: true }).fill(input.plan.name, {
            timeout: workspaceE2ETimeouts.browserAction,
          })
        ),
        id: "fill-access-code-name",
        timeoutMs: workspaceE2ETimeouts.browserAction,
      });
      yield* step({
        execute: input.session.use("fill the access window start", (page) =>
          page
            .getByLabel("Starts", { exact: true })
            .fill(input.plan.startsAtLocal, {
              timeout: workspaceE2ETimeouts.browserAction,
            })
        ),
        id: "fill-window-start",
        timeoutMs: workspaceE2ETimeouts.browserAction,
      });
      yield* step({
        execute: input.session.use("fill the access window end", (page) =>
          page
            .getByLabel("Ends", { exact: true })
            .fill(input.plan.endsAtLocal, {
              timeout: workspaceE2ETimeouts.browserAction,
            })
        ),
        id: "fill-window-end",
        timeoutMs: workspaceE2ETimeouts.browserAction,
      });
      yield* step({
        execute: input.session.use(
          "wait for the hydrated window duration preview",
          (page) =>
            expect(page.getByText(/^Duration: \d+ hours?$/)).toBeVisible({
              timeout: workspaceE2ETimeouts.browserAction,
            })
        ),
        id: "assert-duration-preview",
        timeoutMs: workspaceE2ETimeouts.browserAction,
      });
      yield* step({
        execute: Effect.gen(function* () {
          const actionRequest = yield* input.session.use(
            "activate the create access code submit control once and capture its server action request",
            async (page) => {
              const isActionRequest = (request: Request) =>
                request.method() === "POST" &&
                request.url().startsWith(input.origin) &&
                request.headers()["next-action"] !== undefined;
              const requestPromise = page.waitForRequest(isActionRequest, {
                timeout: workspaceE2ETimeouts.uiTransition,
              });
              const responsePromise = page.waitForResponse(
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
                await page
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
        }),
        id: "submit-creation",
        timeoutMs: workspaceE2ETimeouts.uiTransition,
      });
      yield* step({
        execute: input.session.use(
          "wait for the created access code confirmation",
          (page) =>
            expect(page.locator(createdRegionSelector)).toBeVisible({
              timeout: workspaceE2ETimeouts.uiTransition,
            })
        ),
        id: "wait-for-created-confirmation",
        timeoutMs: workspaceE2ETimeouts.uiTransition,
      });
      yield* step({
        execute: input.session.use(
          "assert the one-time fixture PIN output",
          (page) =>
            expect(
              page.locator(createdRegionSelector).getByRole("status")
            ).toHaveAttribute("aria-label", fixturePinDigitsLabel, {
              timeout: workspaceE2ETimeouts.browserAction,
            })
        ),
        id: "assert-fixture-pin-output",
        timeoutMs: workspaceE2ETimeouts.browserAction,
      });
      yield* step({
        execute: input.session.use(
          "assert the created access code summary",
          (page) =>
            expect(page.locator(createdRegionSelector)).toContainText(
              input.plan.name,
              {
                timeout: workspaceE2ETimeouts.browserAction,
              }
            )
        ),
        id: "assert-created-summary",
        timeoutMs: workspaceE2ETimeouts.browserAction,
      });
      yield* step({
        execute: Effect.gen(function* () {
          if (!capturedAction) {
            return yield* workspaceE2EError(
              "No captured create access code server action request is available for the replay",
              {
                operation: "replay the deployed create access code action",
              }
            );
          }
          const action = capturedAction;
          yield* input.session.use(
            "replay the captured create access code server action request",
            async (page) => {
              const replayResponsePromise = page.request.post(action.url, {
                data: action.body,
                headers: selectActionReplayHeaders(action.headers),
                timeout: workspaceE2ETimeouts.providerTransition,
              });
              // Registered before the response is awaited, so an
              // interrupted replay still gates cleanup.
              replayBarrier = replayResponsePromise.then(
                (): ActionResponseOutcome => ({ kind: "responded" }),
                (): ActionResponseOutcome => ({ kind: "unresolved" })
              );
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
        }),
        id: "replay-deployed-action",
        timeoutMs: workspaceE2ETimeouts.providerTransition,
      });
      yield* step({
        execute: Effect.gen(function* () {
          const events = yield* pollUntil(
            readSyntheticAttemptEvents(db, input.plan.name).pipe(
              Effect.map((rows) => (rows.length === 2 ? rows : undefined))
            ),
            {
              initialIntervalMs: workspaceE2EPollInitialIntervalMs.database,
              intervalMs: workspaceE2EPollIntervalMs.datasource,
              label: "the standalone access code attempt events",
              timeoutMs: workspaceE2ETimeouts.datasource,
            }
          );
          equal(events.length, 2);
          deepStrictEqual(events.map((row) => row.eventKind).sort(), [
            "created",
            "started",
          ]);
          const started = events.find((row) => row.eventKind === "started");
          const created = events.find((row) => row.eventKind === "created");
          ok(started && created);
          const attemptIds = new Set(events.map((row) => row.attemptId));
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
              events.every((row) => row.endsAtLocal === input.plan.endsAtLocal),
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
          const actor = administrator;
          ok(
            actor !== undefined &&
              events.every(
                (row) =>
                  row.actorAccountId === actor.accountId &&
                  row.actorAccountEmail === actor.email
              ),
            "every attempt event must name the seeded administrator account"
          );
          ok(events.every((row) => row.name === input.plan.name));
        }),
        id: "assert-attempt-persistence",
        timeoutMs: workspaceE2ETimeouts.datasource,
      });
    });

    yield* runE2ECase({
      body: caseBody,
      caseId: accessCodeCreationCaseId,
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
      watchdogMs: workspaceE2ETimeouts.accessCodeCase,
    });
  }
);

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

const cleanupSyntheticAttemptEvents = Effect.fn(
  "cleanupSyntheticAttemptEvents"
)(function* (db: DatabaseClient, name: AdministrationStandaloneAccessCodeName) {
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
