import { Effect } from "effect";
import type { WorkspaceE2EDateAllocation } from "../allocation";
import { workspaceE2EMaximumSameDateCoworkReservations } from "../capacity";
import {
  makeCoworkCheckoutData,
  requireCheckoutDate,
  selectCoworkDates,
} from "../checkout/data";
import type { WorkspaceE2EConfig } from "../config";
import { workspaceE2EError } from "../errors";
import type {
  WorkspaceE2EReferralCaseId,
  workspaceE2EReferralCaseIds,
} from "../playwright-checkout/case-catalog";
import type { CheckoutFlowState, WorkspaceE2ECase } from "../types";

/** Referral-lane cases that book one planned cowork checkout. */
export const workspaceE2EReferralCheckoutCaseIds = [
  "referral-profile-completion-checkout",
  "referral-checkout-code-entry",
  "referral-share-link-checkout",
] as const satisfies readonly (typeof workspaceE2EReferralCaseIds)[number][];

const referralCaseIdsWithoutCheckout = [
  "referral-referrer-screen",
  "referral-auto-linked-sign-in",
  "referral-profile-completion-unusable-link",
] as const satisfies readonly WorkspaceE2EReferralCaseId[];

/**
 * Plans the referral lane inside the checkout case catalog: the checkout
 * cases share planned cowork dates no other case uses, so slot planning,
 * journals, and teardown treat them like any other case. The lane spec binds every planned
 * case to its seeded synthetic identities before it runs.
 */
export const planWorkspaceE2EReferralCases = ({
  allocation,
  availableBasicDates,
  config,
  excludedDates,
  trackCheckoutState,
}: {
  readonly allocation: WorkspaceE2EDateAllocation;
  readonly availableBasicDates: readonly string[];
  readonly config: WorkspaceE2EConfig;
  readonly excludedDates: ReadonlySet<string>;
  readonly trackCheckoutState: (
    data: CheckoutFlowState["data"]
  ) => CheckoutFlowState;
}) =>
  Effect.gen(function* () {
    const dates = yield* selectCoworkDates(
      availableBasicDates,
      workspaceE2EReferralCheckoutCaseIds.length,
      {
        allocation,
        excludedDates,
        // Each case books for its own customer, so the unpaid checkouts can
        // share one open-space date.
        maximumReservationsPerDate:
          workspaceE2EMaximumSameDateCoworkReservations["open-space"],
        selectionLabel: "referral lane checkout",
      }
    );
    const unbound = (id: WorkspaceE2EReferralCaseId) => () =>
      Effect.fail(
        workspaceE2EError(
          `Referral case ${id} must be bound to its seeded identities by the case pool`,
          { operation: "bind referral case" }
        )
      );
    const cases: WorkspaceE2ECase[] = [];
    for (const [index, id] of workspaceE2EReferralCheckoutCaseIds.entries()) {
      const date = yield* requireCheckoutDate(dates, index);
      cases.push({
        checkoutStates: [
          trackCheckoutState(makeCoworkCheckoutData(config.baseUrl, date, id)),
        ],
        execute: unbound(id),
        id,
        timeoutMs: config.timeouts.checkoutCase,
      });
    }
    for (const id of referralCaseIdsWithoutCheckout) {
      cases.push({
        checkoutStates: [],
        execute: unbound(id),
        id,
        timeoutMs: config.timeouts.checkoutCase,
      });
    }
    return { cases, dates: [...new Set(dates)] };
  });
