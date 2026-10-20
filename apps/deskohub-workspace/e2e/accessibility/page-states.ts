import { expect, type Page } from "@playwright/test";
import { Effect } from "effect";
import { getAccountSignInPath } from "@/features/account/routes";
import { m } from "@/features/i18n";
import { createReservationAccessToken } from "@/features/reservation/backend/reservation-access-token";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { reservationAccessTokenQueryParam } from "@/features/reservation/reservation-access-token";
import { reservationStatusPath } from "@/features/reservation/routes";
import {
  cleanupWorkspaceE2ELocalReservation,
  seedWorkspaceE2ELocalReservation,
  type WorkspaceE2ELocalReservationPaymentState,
} from "../checkout/local-reservation-fixture";
import { waitForReactSubmitHandler } from "../react-handlers";
import { workspaceE2ETimeouts } from "../timeouts";
import { type AuditedLocale, openSettledPage } from "./accessibility-audit";
import { runWithLocalDatabase } from "./audit-target";

export const reservationForms = [
  { family: "cowork", path: "/reservation/cowork" },
  { family: "meeting-room", path: "/reservation/meeting-room" },
  { family: "office", path: "/reservation/office" },
] as const;

/** The reservation form, scoped by its submit control. */
export const reservationForm = (page: Page) =>
  page.locator("form").filter({ has: page.locator("#reservation-submit") });

/**
 * Submits a hydrated reservation form with its customer fields still empty,
 * so client validation marks them invalid instead of starting checkout.
 */
export async function submitEmptyReservationForm(page: Page) {
  const form = reservationForm(page);
  await waitForReactSubmitHandler(
    page,
    form,
    workspaceE2ETimeouts.browserAction
  );
  await page.locator("#reservation-submit").click();
  await expect(form.locator('[aria-invalid="true"]').first()).toBeVisible();
}

export const openSignIn = (page: Page, locale: AuditedLocale) =>
  openSettledPage(page, getAccountSignInPath(locale));

/** Submits the hydrated sign-in form with an address that fails validation. */
export async function submitInvalidSignInEmail(
  page: Page,
  locale: AuditedLocale
) {
  const form = page.locator("#account-sign-in-form");
  const email = page.locator("#account-sign-in-email");
  await waitForReactSubmitHandler(
    page,
    form,
    workspaceE2ETimeouts.browserAction
  );
  await email.fill("not-an-email-address");
  await page.locator("#account-sign-in-submit").click();
  await expect(email).toHaveAttribute("aria-invalid", "true");
  await expect(
    form.getByText(m.contactValidationEmailInvalid({}, { locale }))
  ).toBeVisible();
}

/**
 * Status outcomes the audit reaches through the real route: an order the
 * visitor may not see, and seeded checkouts whose hold expired after the
 * payment expired, failed, or was cancelled.
 */
export const statusOutcomes = [
  "not_found",
  "expired",
  "failed",
  "cancelled",
] as const satisfies readonly (
  | "not_found"
  | WorkspaceE2ELocalReservationPaymentState
)[];
export type StatusOutcome = (typeof statusOutcomes)[number];

const statusPath = (locale: AuditedLocale, orderId: string) =>
  `/${locale}${reservationStatusPath}/${orderId}`;

/**
 * Opens the status page in one outcome while `use` runs. A seeded checkout is
 * opened with its access token, which the proxy exchanges for the order's
 * access cookie before the page renders, and deleted afterwards.
 */
export async function withStatusOutcome(
  page: Page,
  locale: AuditedLocale,
  outcome: StatusOutcome,
  use: () => Promise<void>
) {
  if (outcome === "not_found") {
    await openSettledPage(
      page,
      statusPath(
        locale,
        workspaceReservationIdSchema.make("accessibility-audit-missing-order")
      )
    );
    await use();
    return;
  }
  const fixture = await runWithLocalDatabase(
    seedWorkspaceE2ELocalReservation({}, outcome)
  );
  try {
    const path = statusPath(locale, fixture.reservationId);
    const accessToken = await Effect.runPromise(
      createReservationAccessToken({ locale, orderId: fixture.reservationId })
    );
    await openSettledPage(
      page,
      `${path}?${new URLSearchParams({ [reservationAccessTokenQueryParam]: accessToken })}`
    );
    await expect(page).toHaveURL((url) => url.pathname === path && !url.search);
    await use();
  } finally {
    await runWithLocalDatabase(cleanupWorkspaceE2ELocalReservation(fixture));
  }
}
