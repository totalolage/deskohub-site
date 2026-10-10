import type { Locator, Page } from "@playwright/test";
import type { ReservationCustomerMode } from "@/features/reservation/reservation-existing-customer";
import {
  type WorkspaceE2EReservationExistingCustomerDiagnosticCode,
  workspaceE2EError,
} from "../errors";
import { waitForReactClickHandler } from "../react-handlers";
import { workspaceE2ETimeouts } from "../timeouts";

const coworkReservationPath = "/en-US/reservation/cowork";
const existingCustomerCardName = "Booking as";
const bookForSomeoneElseName = "Book for someone else";
const useAccountDetailsName = "Use my account details";
// The submit button reports when availability and the advertised price are
// still loading; offer prices render skeletons until they arrive.
const settledSubmitSelector =
  '#reservation-submit[data-reservation-availability-loading="false"][data-reservation-price-loading="false"]';
const loadingSkeletonSelector = 'main [data-slot="skeleton"]';
// The required marker is CSS generated content, so the accessible name may
// end in " *".
const contactInputNames = {
  email: /^Email(?:\s*\*)?$/,
  name: /^Name(?:\s*\*)?$/,
  phone: /^Phone(?:\s*\*)?$/,
} as const;

export const reservationExistingCustomerFailureMessage =
  "Reservation existing customer verification failed";
export const reservationExistingCustomerOperation =
  "verify reservation existing customer card";

export type ReservationExistingCustomerVerification = {
  readonly baseUrl: string;
  /** Captures the allowlisted review screenshot of the current mode. */
  readonly captureReview: (mode: ReservationCustomerMode) => Promise<void>;
  /** The linked account contact the card must show. */
  readonly contact: { readonly email: string; readonly name: string };
  readonly page: Page;
};

/**
 * Checks the cowork reservation customer section of a signed-in, linked
 * account without submitting anything: the account card shows the profile
 * name and login email instead of the contact inputs, "book for someone
 * else" opens empty contact inputs, and "use my account details" restores
 * the card. Each mode is captured once the form has finished loading. Failures carry only a closed phase diagnostic, never the
 * Playwright cause, which can quote the private contact.
 */
export async function verifyReservationExistingCustomer({
  baseUrl,
  captureReview,
  contact,
  page,
}: ReservationExistingCustomerVerification): Promise<void> {
  let diagnosticCode: WorkspaceE2EReservationExistingCustomerDiagnosticCode =
    "account_reservation_existing_customer_page_failed";

  try {
    const card = page.getByRole("region", {
      exact: true,
      name: existingCustomerCardName,
    });
    const contactInput = (field: keyof typeof contactInputNames) =>
      page.getByRole("textbox", { name: contactInputNames[field] });

    const expectAccountCard = async (): Promise<void> => {
      await card.waitFor({
        state: "visible",
        timeout: workspaceE2ETimeouts.uiTransition,
      });
      for (const text of [contact.name, contact.email]) {
        await card.getByText(text, { exact: true }).waitFor({
          state: "visible",
          timeout: workspaceE2ETimeouts.browserAction,
        });
      }
      for (const field of ["name", "email"] as const) {
        await expectAbsent(contactInput(field));
      }
    };

    const switchMode = async (buttonName: string): Promise<void> => {
      const button = page.getByRole("button", {
        exact: true,
        name: buttonName,
      });
      await button.waitFor({
        state: "visible",
        timeout: workspaceE2ETimeouts.browserAction,
      });
      await waitForReactClickHandler(page, button);
      await button.click({ timeout: workspaceE2ETimeouts.browserAction });
    };

    // Reviews show the settled form from the top; the mode switch click
    // scrolls the page, which full-page captures render as a displaced
    // sticky header.
    const settleForReview = async (): Promise<void> => {
      await page.locator(settledSubmitSelector).waitFor({
        state: "visible",
        timeout: workspaceE2ETimeouts.uiTransition,
      });
      await page.locator(loadingSkeletonSelector).first().waitFor({
        state: "hidden",
        timeout: workspaceE2ETimeouts.uiTransition,
      });
      await page.evaluate(() => window.scrollTo(0, 0));
    };

    await page.goto(new URL(coworkReservationPath, baseUrl).toString(), {
      timeout: workspaceE2ETimeouts.browserNavigation,
      waitUntil: "load",
    });

    diagnosticCode = "account_reservation_existing_customer_card_failed";
    await expectAccountCard();

    diagnosticCode = "account_reservation_existing_customer_card_review_failed";
    await settleForReview();
    await captureReview("account");

    diagnosticCode =
      "account_reservation_existing_customer_contact_switch_failed";
    await switchMode(bookForSomeoneElseName);

    diagnosticCode =
      "account_reservation_existing_customer_contact_inputs_failed";
    for (const field of ["email", "phone", "name"] as const) {
      const input = contactInput(field);
      await input.waitFor({
        state: "visible",
        timeout: workspaceE2ETimeouts.uiTransition,
      });
      if ((await input.inputValue()) !== "") throw new Error(field);
    }
    await expectAbsent(card);

    diagnosticCode =
      "account_reservation_existing_customer_contact_review_failed";
    await settleForReview();
    await captureReview("contact");

    diagnosticCode =
      "account_reservation_existing_customer_account_switch_failed";
    await switchMode(useAccountDetailsName);

    diagnosticCode =
      "account_reservation_existing_customer_card_restore_failed";
    await expectAccountCard();
  } catch {
    throw workspaceE2EError(reservationExistingCustomerFailureMessage, {
      diagnosticCode,
      operation: reservationExistingCustomerOperation,
    });
  }
}

const expectAbsent = async (locator: Locator): Promise<void> => {
  if ((await locator.count()) !== 0) throw new Error("unexpected element");
};
