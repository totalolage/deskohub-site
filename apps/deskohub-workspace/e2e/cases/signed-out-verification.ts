import { Effect } from "effect";
import type { WorkspaceE2EAccountJournalOwner } from "../account/reconcile";
import type { WorkspaceE2EDateAllocation } from "../allocation";
import {
  makeCoworkCheckoutData,
  requireCheckoutDate,
  selectCoworkDates,
} from "../checkout/data";
import type { WorkspaceE2EConfig } from "../config";
import { type WorkspaceE2EError, workspaceE2EError } from "../errors";
import type { WorkspaceE2ECaseBinder } from "../playwright-checkout/fixtures";
import type { CheckoutFlowState, WorkspaceE2ECase } from "../types";

export const signedOutVerificationCaseId = "checkout-signed-out-verification";

const accountRecipientLabel = "sov-account";

/**
 * The case's own identity journal: the account the verification signs in
 * and the profile its checkout saves, derived from one run-scoped recipient.
 */
export const signedOutVerificationJournalOwner: WorkspaceE2EAccountJournalOwner =
  {
    ownerId: signedOutVerificationCaseId,
    recipientLabels: [accountRecipientLabel],
  };

/**
 * Plans the signed-out checkout on its own cowork date, after every other
 * case has planned its dates. The case pool binds the run-scoped recipient
 * before the case runs.
 */
export const planSignedOutVerificationCase = ({
  allocation,
  availableBasicDates,
  config,
  flowStates,
}: {
  readonly allocation: WorkspaceE2EDateAllocation;
  readonly availableBasicDates: readonly string[];
  readonly config: WorkspaceE2EConfig;
  readonly flowStates: CheckoutFlowState[];
}): Effect.Effect<WorkspaceE2ECase, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const dates = yield* selectCoworkDates(availableBasicDates, 1, {
      allocation,
      excludedDates: new Set(flowStates.map(({ data }) => data.date)),
      selectionLabel: "signed-out verification",
    });
    const state: CheckoutFlowState = {
      data: makeCoworkCheckoutData(
        config.baseUrl,
        yield* requireCheckoutDate(dates, 0),
        signedOutVerificationCaseId
      ),
    };
    flowStates.push(state);
    return {
      checkoutStates: [state],
      execute: () =>
        Effect.fail(
          workspaceE2EError(
            `${signedOutVerificationCaseId} must be bound to its run-scoped recipient by the case pool`,
            { operation: "bind signed-out verification case" }
          )
        ),
      id: signedOutVerificationCaseId,
      timeoutMs: config.timeouts.checkoutCase,
    };
  });

/** Binds the planned case to this run's synthetic recipient. */
export const bindSignedOutVerificationCase: WorkspaceE2ECaseBinder = async ({
  testCase,
}) => {
  if (testCase.id !== signedOutVerificationCaseId) return testCase;
  throw new Error(`${signedOutVerificationCaseId} is not implemented yet`);
};
