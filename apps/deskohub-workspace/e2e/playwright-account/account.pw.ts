import "../../shared/polyfills/temporal";

import { expect, type Page } from "@playwright/test";
import { Effect } from "effect";
import { getWorkspaceE2EDateInterval } from "../capacity";
import { getConfig, getDatasourceConfig } from "../config";
import { toWorkspaceE2EError, tryWorkspaceE2ESync } from "../errors";
import { enablePreviewAccess } from "../instant-navigation/navigation-test-helpers";
import { waitForCheckoutRow } from "../integrations/database";
import {
  cancelDotyposReservation,
  waitForCancelledDotyposReservations,
} from "../integrations/dotypos";
import { useNeonAuthMagicLinkCapture } from "../integrations/neon-auth";
import { readWorkspaceE2ECaseJournals } from "../playwright-checkout/run-plan";
import { runtimeTest as test } from "../playwright-checkout/runtime-fixtures";
import { assert } from "../runtime";
import {
  assertNoSession,
  browserStep,
  deleteCustomerAccountLinks,
  requestMagicLink,
  requireSession,
  waitForCustomerAccountLink,
} from "./account-auth";

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
