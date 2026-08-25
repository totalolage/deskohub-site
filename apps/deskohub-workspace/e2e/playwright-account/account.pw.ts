import "../../shared/polyfills/temporal";

import { expect, type Page } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { customerAccountLinks } from "@/db/schema";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import { getWorkspaceE2EDateInterval } from "../capacity";
import {
  getConfig,
  getDatasourceConfig,
  type WorkspaceE2EConfig,
} from "../config";
import {
  toWorkspaceE2EError,
  tryWorkspaceE2EPromise,
  tryWorkspaceE2ESync,
} from "../errors";
import { enablePreviewAccess } from "../instant-navigation/navigation-test-helpers";
import { waitForCheckoutRow } from "../integrations/database";
import { E2EDatabase } from "../integrations/database.service";
import { runRetrySafeDatabaseOperation } from "../integrations/database-operation";
import {
  cancelDotyposReservation,
  waitForCancelledDotyposReservations,
} from "../integrations/dotypos";
import {
  type NeonAuthMagicLinkCapture,
  useNeonAuthMagicLinkCapture,
} from "../integrations/neon-auth";
import { readWorkspaceE2ECaseJournals } from "../playwright-checkout/run-plan";
import { runtimeTest as test } from "../playwright-checkout/runtime-fixtures";
import { pollUntil } from "../polling";
import { assert } from "../runtime";
import { workspaceE2EPollIntervalMs } from "../timeouts";

type BrowserAuthSession = {
  readonly user: {
    readonly email: string;
    readonly emailVerified: boolean;
    readonly id: string;
    readonly name: string;
  };
};

const browserStep = <A>(operation: string, run: () => Promise<A>) =>
  tryWorkspaceE2EPromise(operation, run);

test.beforeEach(async ({ baseURL, context }) => {
  await enablePreviewAccess(context, baseURL);
});

test("customer account lifecycle", async ({ environment, page, runEffect }) => {
  const config = getConfig(environment);
  test.setTimeout(config.timeouts.accountCase);
  const datasourceConfig = getDatasourceConfig(environment);
  const neonAuth = datasourceConfig.neonAuth;
  assert(neonAuth, "Neon Auth configuration is required for account E2E");

  const [state] = await readWorkspaceE2ECaseJournals(["checkout-cowork-basic"]);
  assert(state?.orderId, "account E2E checkout order is missing");
  const checkoutRow = await runEffect(
    waitForCheckoutRow(datasourceConfig, state.orderId)
  );
  const dotyposCustomerId = checkoutRow.dotypos_customer_id;
  const dotyposReservationId = checkoutRow.dotypos_reservation_id;
  assert(dotyposCustomerId, "account E2E Dotypos customer is missing");
  assert(dotyposReservationId, "account E2E Dotypos reservation is missing");

  await expectProtectedAccountRedirect(page);

  await runEffect(
    Effect.acquireUseRelease(
      Effect.sync(() => new Set<string>()),
      (accountIds) =>
        useNeonAuthMagicLinkCapture(neonAuth, state.data.email, (capture) =>
          Effect.gen(function* () {
            yield* requestMagicLink({
              callbackPath: "/en-US/account",
              capture,
              config,
              email: state.data.email,
              page,
              validateInvalidEmail: true,
            });
            const firstSession = yield* requireSession(page, state.data.email);
            capture.rememberUserId(firstSession.user.id);
            accountIds.add(firstSession.user.id);

            yield* assertReservationGroup(page, "current", [
              "Basic Day Pass",
              "Confirmed",
            ]);
            yield* assertReservationGroup(page, "past", [
              "You have no past reservations yet.",
            ]);
            yield* waitForCustomerAccountLink(
              firstSession.user.id,
              dotyposCustomerId,
              true
            );

            const updatedName = `${state.data.name} Account`;
            yield* browserStep("update customer profile", async () => {
              await page.getByLabel("Name").fill(updatedName);
              await page.getByRole("button", { name: "Save profile" }).click();
              await expect(page.getByText("Profile updated.")).toBeVisible();
              await page.reload();
              await expect(page.getByLabel("Name")).toHaveValue(updatedName);
            });

            yield* browserStep("sign out customer account", async () => {
              await page.getByRole("link", { name: "Sign out" }).click();
              await expectProtectedAccountRedirect(page);
            });
            yield* assertNoSession(page);

            yield* requestMagicLink({
              callbackPath: "/en-US/account",
              capture,
              config,
              email: state.data.email,
              page,
              validateInvalidEmail: false,
            });
            const returningSession = yield* requireSession(
              page,
              state.data.email
            );
            yield* tryWorkspaceE2ESync(
              "assert returning customer account",
              () => {
                assert(
                  returningSession.user.id === firstSession.user.id,
                  "magic-link login created another account"
                );
                assert(
                  returningSession.user.name === updatedName,
                  "customer profile did not persist"
                );
              }
            );

            yield* cancelDotyposReservation(
              datasourceConfig,
              dotyposReservationId
            );
            yield* waitForCancelledDotyposReservations(
              datasourceConfig,
              [dotyposReservationId],
              getWorkspaceE2EDateInterval({
                fromDate: state.data.date,
                toDate: state.data.date,
              })
            );
            yield* browserStep("reload cancelled reservation history", () =>
              page.reload().then(() => undefined)
            );
            yield* assertReservationGroup(page, "past", [
              "Basic Day Pass",
              "Cancelled",
            ]);
            yield* assertReservationGroup(page, "current", [
              "You have no current or upcoming reservations.",
            ]);

            yield* browserStep("delete customer account", async () => {
              await page
                .getByRole("button", { name: "Delete my account" })
                .click();
              const dialog = page.getByRole("dialog", {
                name: "Permanently delete this account?",
              });
              const confirm = dialog.getByRole("button", {
                name: "Delete permanently",
              });
              await expect(confirm).toBeDisabled();
              await dialog
                .getByRole("checkbox", { name: /I understand that my account/ })
                .check();
              await expect(confirm).toBeEnabled();
              await confirm.click();
              await expect(page).toHaveURL((url) => url.pathname === "/en-US");
            });
            yield* assertNoSession(page);
            yield* waitForCustomerAccountLink(
              firstSession.user.id,
              undefined,
              false
            );
            yield* browserStep("recheck deleted account protection", () =>
              expectProtectedAccountRedirect(page)
            );

            yield* requestMagicLink({
              callbackPath: "/en-US/account",
              capture,
              config,
              email: state.data.email,
              page,
              validateInvalidEmail: false,
            });
            const freshSession = yield* requireSession(page, state.data.email);
            capture.rememberUserId(freshSession.user.id);
            accountIds.add(freshSession.user.id);
            yield* tryWorkspaceE2ESync(
              "assert fresh account after deletion",
              () => {
                assert(
                  freshSession.user.id !== firstSession.user.id,
                  "deleted auth identity was resumed"
                );
                assert(
                  freshSession.user.name !== updatedName,
                  "deleted customer profile was retained"
                );
              }
            );
          }).pipe(
            Effect.mapError((cause) =>
              toWorkspaceE2EError("run customer account lifecycle", cause)
            )
          )
        ),
      (accountIds) =>
        deleteCustomerAccountLinks(accountIds).pipe(
          Effect.mapError((cause) =>
            toWorkspaceE2EError("clean up customer account links", cause)
          )
        )
    )
  );
});

const expectProtectedAccountRedirect = async (page: Page) => {
  await page.goto("/en-US/account");
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === "/en-US/auth/sign-in" &&
      url.searchParams.get("redirectTo") === "/en-US/account"
  );
};

const requestMagicLink = ({
  callbackPath,
  capture,
  config,
  email,
  page,
  validateInvalidEmail,
}: {
  readonly callbackPath: string;
  readonly capture: NeonAuthMagicLinkCapture;
  readonly config: WorkspaceE2EConfig;
  readonly email: string;
  readonly page: Page;
  readonly validateInvalidEmail: boolean;
}) =>
  Effect.gen(function* () {
    yield* browserStep("open magic-link sign in", async () => {
      await page.goto(
        `/en-US/auth/sign-in?redirectTo=${encodeURIComponent(callbackPath)}`
      );
      const emailField = page.getByLabel("Email");
      if (validateInvalidEmail) {
        await emailField.fill("invalid");
        await page
          .getByRole("button", { name: "Email me a sign-in link" })
          .click();
        await expect(page.getByText("Email is invalid")).toBeVisible();
      }
      await emailField.fill(email);
      await page
        .getByRole("button", { name: "Email me a sign-in link" })
        .click();
      await expect(
        page.getByText("Check your inbox for your sign-in link.")
      ).toBeVisible();
    });
    const verificationUrl = yield* capture.nextVerificationUrl(
      config,
      callbackPath
    );
    yield* browserStep("follow captured magic link", async () => {
      await page.goto(verificationUrl);
      await expect(page).toHaveURL((url) => url.pathname === callbackPath);
    });
  });

const readSession = (page: Page) =>
  browserStep("read authoritative Neon Auth session", () =>
    page.evaluate(async () => {
      const response = await fetch(
        "/api/auth/get-session?disableCookieCache=true",
        { cache: "no-store", credentials: "same-origin" }
      );
      if (!response.ok) throw new Error("authoritative session request failed");
      return (await response.json()) as unknown;
    })
  );

const requireSession = (page: Page, email: string) =>
  Effect.flatMap(readSession(page), (value) =>
    tryWorkspaceE2ESync("validate authoritative Neon Auth session", () => {
      assert(value && typeof value === "object", "auth session is missing");
      const user = (value as { readonly user?: unknown }).user;
      assert(user && typeof user === "object", "auth session user is missing");
      const candidate = user as Record<string, unknown>;
      assert(typeof candidate.id === "string", "auth user ID is invalid");
      assert(candidate.email === email, "auth user email does not match");
      assert(candidate.emailVerified === true, "auth user email is unverified");
      assert(typeof candidate.name === "string", "auth user name is invalid");
      return {
        user: {
          email: candidate.email,
          emailVerified: candidate.emailVerified,
          id: candidate.id,
          name: candidate.name,
        },
      } as BrowserAuthSession;
    })
  );

const assertNoSession = (page: Page) =>
  Effect.flatMap(readSession(page), (session) =>
    tryWorkspaceE2ESync("assert absent Neon Auth session", () => {
      assert(session === null, "customer session is still active");
    })
  );

const assertReservationGroup = (
  page: Page,
  group: "current" | "past",
  expectedText: readonly string[]
) =>
  browserStep(`assert ${group} account reservations`, async () => {
    const section = page.locator(`[data-account-reservation-group="${group}"]`);
    for (const value of expectedText)
      await expect(section).toContainText(value);
  });

const waitForCustomerAccountLink = (
  accountId: string,
  customerId: string | undefined,
  shouldExist: boolean
) =>
  Effect.gen(function* () {
    const { db } = yield* E2EDatabase;
    const decodedAccountId = yield* Schema.decodeEffect(
      customerAccountIdSchema
    )(accountId);
    yield* pollUntil(
      runRetrySafeDatabaseOperation(
        "read customer account link",
        db
          .select({ customerId: customerAccountLinks.dotyposCustomerId })
          .from(customerAccountLinks)
          .where(eq(customerAccountLinks.customerAccountId, decodedAccountId))
          .limit(1)
      ).pipe(
        Effect.map(([row]) => {
          if (!shouldExist) return row ? undefined : true;
          return row?.customerId === customerId ? true : undefined;
        })
      ),
      {
        intervalMs: workspaceE2EPollIntervalMs.datasource,
        label: shouldExist
          ? "customer account link"
          : "deleted customer account link",
        timeoutMs: 60_000,
      }
    );
  });

const deleteCustomerAccountLinks = (accountIds: ReadonlySet<string>) =>
  Effect.gen(function* () {
    if (accountIds.size === 0) return;
    const { db } = yield* E2EDatabase;
    const decodedAccountIds = yield* Effect.all(
      [...accountIds].map((accountId) =>
        Schema.decodeEffect(customerAccountIdSchema)(accountId)
      ),
      { concurrency: "inherit" }
    );
    yield* runRetrySafeDatabaseOperation(
      "delete synthetic customer account links",
      db
        .delete(customerAccountLinks)
        .where(
          inArray(customerAccountLinks.customerAccountId, decodedAccountIds)
        )
    );
  });
