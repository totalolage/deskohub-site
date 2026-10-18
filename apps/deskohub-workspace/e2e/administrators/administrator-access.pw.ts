import { equal, ok } from "node:assert/strict";
import type { BrowserContext, Page } from "@playwright/test";
import { Effect } from "effect";
import { resolveWorkspaceE2ESessionSigningSecret } from "../account/seeded-session";
import {
  openAdminBrowserPage,
  primePreviewBypass,
  reportAdminCaseFailure,
  runFinalizedCase,
  sanitizedBrowserOperation,
} from "../admin-case";
import type { WorkspaceE2EError } from "../errors";
import { writeWorkspaceE2EFailureAnnotation } from "../github-actions";
import type { E2EDatabase } from "../integrations/database.service";
import { runtimeTest as test } from "../playwright-checkout/runtime-fixtures";
import { withinWorkspaceE2EDeadline } from "../polling";
import { addRedaction } from "../runtime";
import { E2ETelemetryService, toE2EResult } from "../services/telemetry";
import type { WorkspaceE2EFailureReporter } from "../suite";
import { workspaceE2ETimeouts } from "../timeouts";
import {
  makeWorkspaceE2EAdministrationIdentities,
  type WorkspaceE2EAdministrationCaseId,
} from "./identities";

// A localized administration URL with a query, so the return path proves the
// whole original request survives the sign-in redirect.
const administrationTargetPath = "/en-US/admin/reservations?page=1";
const signInPathname = "/en-US/auth/sign-in";
const signInReturnParam = "returnTo";

type CaseStep = (
  stepId: string,
  timeoutMs: number,
  execute: Effect.Effect<void, WorkspaceE2EError, E2EDatabase>
) => Effect.Effect<void, WorkspaceE2EError, E2EDatabase>;

test("sends a signed-out administration URL to sign-in with its return path, which a seeded administrator then opens", async ({
  baseURL,
  browser,
  environment,
  runContext,
  runEffect,
}) => {
  const caseId = "administrator-sign-in-return";
  const identities = makeWorkspaceE2EAdministrationIdentities<"asr-admin">({
    ownerId: caseId,
    runId: runContext.runId,
    secret: resolveWorkspaceE2ESessionSigningSecret(environment),
  });
  addRedaction(environment.VERCEL_AUTOMATION_BYPASS_SECRET);
  const { context, origin, page } = await openAdminBrowserPage({
    baseURL,
    browser,
    caseName: "administrator sign-in return",
  });
  try {
    await runEffect(
      runAdministratorAccessCase({
        bypassSecret: environment.VERCEL_AUTOMATION_BYPASS_SECRET,
        caseId,
        context,
        origin,
        reportFailure:
          runContext.githubRunId === undefined
            ? undefined
            : writeWorkspaceE2EFailureAnnotation,
        body: (step) =>
          Effect.gen(function* () {
            let returnPath: string | undefined;
            yield* step(
              "redirect-signed-out-administration-url",
              workspaceE2ETimeouts.browserNavigation,
              sanitizedBrowserOperation(
                "request the administration URL signed out",
                async () => {
                  const response = await context.request.get(
                    new URL(administrationTargetPath, origin).toString(),
                    {
                      maxRedirects: 0,
                      timeout: workspaceE2ETimeouts.browserNavigation,
                    }
                  );
                  try {
                    equal(
                      response.status(),
                      307,
                      "a signed-out administration page load must redirect temporarily"
                    );
                    const location = new URL(
                      response.headers().location ?? "",
                      origin
                    );
                    equal(
                      location.origin,
                      origin,
                      "the sign-in redirect must stay on the preview origin"
                    );
                    equal(
                      location.pathname,
                      signInPathname,
                      "the administration redirect must open the localized sign-in page"
                    );
                    returnPath =
                      location.searchParams.get(signInReturnParam) ?? undefined;
                    equal(
                      returnPath,
                      administrationTargetPath,
                      "the sign-in redirect must carry the original path and query"
                    );
                  } finally {
                    await response.dispose();
                  }
                }
              )
            );
            yield* step(
              "show-sign-in-form",
              workspaceE2ETimeouts.browserNavigation,
              sanitizedBrowserOperation(
                "open the administration URL signed out in the browser",
                async () => {
                  await page.goto(
                    new URL(administrationTargetPath, origin).toString(),
                    { timeout: workspaceE2ETimeouts.browserNavigation }
                  );
                  const url = new URL(page.url());
                  equal(url.pathname, signInPathname);
                  equal(
                    url.searchParams.get(signInReturnParam),
                    administrationTargetPath
                  );
                  await page.locator("#account-sign-in-form").waitFor({
                    state: "visible",
                    timeout: workspaceE2ETimeouts.browserAction,
                  });
                }
              )
            );
            yield* step(
              "sign-in-seeded-administrator",
              workspaceE2ETimeouts.datasource,
              Effect.gen(function* () {
                const administrator = yield* identities.seed("asr-admin", [
                  "administrator",
                ]);
                yield* identities.signIn(administrator, { context, origin });
              })
            );
            yield* step(
              "open-return-path-as-administrator",
              workspaceE2ETimeouts.browserNavigation,
              sanitizedBrowserOperation(
                "open the sign-in return path as the administrator",
                async () => {
                  ok(returnPath, "the sign-in return path was not captured");
                  // The page streams its data behind the shell; the gate
                  // decision is in the status and the shell, not the data.
                  const response = await page.goto(
                    new URL(returnPath, origin).toString(),
                    {
                      timeout: workspaceE2ETimeouts.browserNavigation,
                      waitUntil: "commit",
                    }
                  );
                  equal(response?.status(), 200);
                  const url = new URL(page.url());
                  equal(`${url.pathname}${url.search}`, returnPath);
                  await expectAdministrationContent(page, "Reservations");
                }
              )
            );
          }),
      })
    );
  } finally {
    await context.close().catch(() => undefined);
  }
});

test("answers a signed-in account without the administrator role with the ordinary 404", async ({
  baseURL,
  browser,
  environment,
  runContext,
  runEffect,
}) => {
  const caseId = "administrator-non-administrator-refusal";
  const identities = makeWorkspaceE2EAdministrationIdentities<"anr-member">({
    ownerId: caseId,
    runId: runContext.runId,
    secret: resolveWorkspaceE2ESessionSigningSecret(environment),
  });
  addRedaction(environment.VERCEL_AUTOMATION_BYPASS_SECRET);
  const { context, origin, page } = await openAdminBrowserPage({
    baseURL,
    browser,
    caseName: "non-administrator refusal",
  });
  try {
    await runEffect(
      runAdministratorAccessCase({
        bypassSecret: environment.VERCEL_AUTOMATION_BYPASS_SECRET,
        caseId,
        context,
        origin,
        reportFailure:
          runContext.githubRunId === undefined
            ? undefined
            : writeWorkspaceE2EFailureAnnotation,
        body: (step) =>
          Effect.gen(function* () {
            yield* step(
              "sign-in-seeded-account-without-role",
              workspaceE2ETimeouts.datasource,
              Effect.gen(function* () {
                const member = yield* identities.seed("anr-member", []);
                yield* identities.signIn(member, { context, origin });
              })
            );
            yield* step(
              "refuse-administration-overview",
              workspaceE2ETimeouts.browserNavigation,
              sanitizedBrowserOperation(
                "open the administration overview without the role",
                async () => {
                  const response = await page.goto(
                    new URL("/en-US/admin", origin).toString(),
                    { timeout: workspaceE2ETimeouts.browserNavigation }
                  );
                  equal(
                    response?.status(),
                    404,
                    "a signed-in account without the role must get the ordinary 404"
                  );
                  equal(
                    new URL(page.url()).pathname,
                    "/en-US/admin",
                    "the refusal must not redirect to sign-in"
                  );
                  equal(
                    await page
                      .getByRole("navigation", { name: "Administration" })
                      .count(),
                    0,
                    "the refused page must not render the administration shell"
                  );
                }
              )
            );
          }),
      })
    );
  } finally {
    await context.close().catch(() => undefined);
  }
});

const expectAdministrationContent = async (page: Page, heading: string) => {
  await page
    .getByRole("navigation", { name: "Administration" })
    .first()
    .waitFor({ state: "visible", timeout: workspaceE2ETimeouts.browserAction });
  await page
    .getByRole("heading", { level: 1, name: heading })
    .waitFor({ state: "attached", timeout: workspaceE2ETimeouts.browserAction });
};

/**
 * Runs one administrator access case: the bypass is primed first, every step
 * is traced with its own deadline inside the case watchdog, and the context
 * closes in a bounded finalizer. Suite cleanup deletes the seeded accounts,
 * which cascades their sessions and role grants.
 */
const runAdministratorAccessCase = Effect.fn("runAdministratorAccessCase")(
  function* (input: {
    readonly body: (step: CaseStep) => Effect.Effect<
      void,
      WorkspaceE2EError,
      E2EDatabase
    >;
    readonly bypassSecret: string | undefined;
    readonly caseId: WorkspaceE2EAdministrationCaseId;
    readonly context: BrowserContext;
    readonly origin: string;
    readonly reportFailure?: WorkspaceE2EFailureReporter;
  }) {
    const telemetry = yield* E2ETelemetryService;
    let terminalStepId: string | undefined;

    const step: CaseStep = (stepId, timeoutMs, execute) => {
      const operation = `${input.caseId}/${stepId}`;
      return telemetry.traceStep({
        caseId: input.caseId,
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

    yield* runFinalizedCase({
      body: withinWorkspaceE2EDeadline(
        Effect.gen(function* () {
          yield* step(
            "prime-preview-bypass",
            workspaceE2ETimeouts.browserAction,
            primePreviewBypass({
              bypassSecret: input.bypassSecret,
              context: input.context,
              origin: input.origin,
            })
          );
          yield* input.body(step);
        }),
        `${input.caseId} e2e case`,
        workspaceE2ETimeouts.administratorAccessCase
      ),
      cleanup: withinWorkspaceE2EDeadline(
        sanitizedBrowserOperation(
          `close the ${input.caseId} browser context`,
          () => input.context.close()
        ),
        `${input.caseId}/cleanup`,
        workspaceE2ETimeouts.browserAction
      ).pipe(Effect.orDie),
      trace: (effect) =>
        telemetry.traceCase({
          caseId: input.caseId,
          effect,
          timeoutMs: workspaceE2ETimeouts.administratorAccessCase,
        }),
      onExit: reportAdminCaseFailure({
        caseId: input.caseId,
        reportFailure: input.reportFailure,
        terminalStepId: () => terminalStepId,
      }),
    });
  }
);
