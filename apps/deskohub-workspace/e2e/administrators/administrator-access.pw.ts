import { equal, ok } from "node:assert/strict";
import type { Page } from "@playwright/test";
import { Effect } from "effect";
import { resolveWorkspaceE2ESessionSigningSecret } from "../account/seeded-session";
import { openAdminBrowserPage, sanitizedBrowserOperation } from "../admin-case";
import { writeWorkspaceE2EFailureAnnotation } from "../github-actions";
import { runtimeTest as test } from "../playwright-checkout/runtime-fixtures";
import { addRedaction } from "../runtime";
import { workspaceE2ETimeouts } from "../timeouts";
import { runAdministratorCase } from "./administrator-case";
import { makeWorkspaceE2EAdministrationIdentities } from "./identities";

// A localized administration URL with a query, so the return path proves the
// whole original request survives the sign-in redirect.
const administrationTargetPath = "/en-US/admin/reservations?page=1";
const signInPathname = "/en-US/auth/sign-in";
const signInReturnParam = "returnTo";

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
      runAdministratorCase({
        bypassSecret: environment.VERCEL_AUTOMATION_BYPASS_SECRET,
        caseId,
        context,
        origin,
        reportFailure:
          runContext.githubRunId === undefined
            ? undefined
            : writeWorkspaceE2EFailureAnnotation,
        body: Effect.fn(function* (step) {
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
      runAdministratorCase({
        bypassSecret: environment.VERCEL_AUTOMATION_BYPASS_SECRET,
        caseId,
        context,
        origin,
        reportFailure:
          runContext.githubRunId === undefined
            ? undefined
            : writeWorkspaceE2EFailureAnnotation,
        body: Effect.fn(function* (step) {
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
  await page.getByRole("heading", { level: 1, name: heading }).waitFor({
    state: "attached",
    timeout: workspaceE2ETimeouts.browserAction,
  });
};
