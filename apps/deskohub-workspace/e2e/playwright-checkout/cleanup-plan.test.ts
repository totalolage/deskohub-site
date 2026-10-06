import { expect, test } from "bun:test";
import {
  emptyWorkspaceE2EAccountJournal,
  parseWorkspaceE2EAccountJournal,
} from "../account/journal";
import {
  validateWorkspaceE2EAccountLaneJournalOwnership,
  type WorkspaceE2EAccountLaneReconciliation,
} from "../account/reconcile";
import { runWorkspaceE2ECleanupWithPreparedCandidates } from "./cleanup-plan";

test("does not start checkout cleanup when account journal validation fails", async () => {
  let checkoutCleanupStarted = false;

  await expect(
    runWorkspaceE2ECleanupWithPreparedCandidates({
      readAccountLaneJournal: async () => {
        throw new Error("invalid account lane journal");
      },
      readCheckoutFlowStates: async () => [],
      reconcile: async () => {
        checkoutCleanupStarted = true;
      },
    })
  ).rejects.toThrow("invalid account lane journal");

  expect(checkoutCleanupStarted).toBe(false);
});

test("passes both prevalidated journal scopes to the existing cleanup", async () => {
  const accountLaneJournal: WorkspaceE2EAccountLaneReconciliation = {
    journal: emptyWorkspaceE2EAccountJournal(),
    authUserIds: [],
    dotyposCustomerIds: [],
    dotyposReservationIds: [],
  };
  let reconciledScopes: readonly string[] = [];

  await runWorkspaceE2ECleanupWithPreparedCandidates({
    readAccountLaneJournal: async () => accountLaneJournal,
    readCheckoutFlowStates: async () => [],
    reconcile: async ({ accountLaneJournal: preparedAccountJournal }) => {
      reconciledScopes = [
        "checkout-journals",
        preparedAccountJournal === accountLaneJournal ? "account-lane" : "",
      ];
    },
  });

  expect(reconciledScopes).toEqual(["checkout-journals", "account-lane"]);
});

test("rejects a parsed account candidate owned by another run before checkout cleanup", async () => {
  const parsedJournal = parseWorkspaceE2EAccountJournal(
    JSON.stringify({
      ...emptyWorkspaceE2EAccountJournal(),
      authUserIds: ["synthetic-user"],
    })
  );
  let checkoutCleanupStarted = false;

  await expect(
    runWorkspaceE2ECleanupWithPreparedCandidates({
      readAccountLaneJournal: async () =>
        validateWorkspaceE2EAccountLaneJournalOwnership({
          journal: parsedJournal,
          recipientEmails: new Set(["delivered+source-run-main@resend.dev"]),
          authUserOwners: new Map([
            ["synthetic-user", "delivered+other-run-main@resend.dev"],
          ]),
          customerOwners: new Map(),
          reservationOwners: new Map(),
        }),
      readCheckoutFlowStates: async () => [],
      reconcile: async () => {
        checkoutCleanupStarted = true;
      },
    })
  ).rejects.toThrow("Workspace account e2e journal ownership mismatch");

  expect(checkoutCleanupStarted).toBe(false);
});

test("drops already-absent account candidates before idempotent reconciliation", () => {
  const journal = parseWorkspaceE2EAccountJournal(
    JSON.stringify({
      ...emptyWorkspaceE2EAccountJournal(),
      authUserIds: ["removed-user"],
      dotyposCustomerIds: ["expired-customer"],
    })
  );

  const prepared = validateWorkspaceE2EAccountLaneJournalOwnership({
    journal,
    recipientEmails: new Set(["delivered+source-run-main@resend.dev"]),
    authUserOwners: new Map([["removed-user", undefined]]),
    customerOwners: new Map([["expired-customer", undefined]]),
    reservationOwners: new Map(),
  });

  expect(prepared).toMatchObject({
    journal,
    authUserIds: [],
    dotyposCustomerIds: [],
    dotyposReservationIds: [],
  });
});
