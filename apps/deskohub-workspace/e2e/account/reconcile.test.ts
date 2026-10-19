import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import {
  emptyWorkspaceE2EAccountJournal,
  type WorkspaceE2EAccountJournal,
} from "./journal";
import { validateWorkspaceE2EAccountLaneJournalOwnership } from "./reconcile";

const recipient = testEmailAddress("delivered+agent-run-agent");
const otherContact = testEmailAddress("someone.else");

const journal: WorkspaceE2EAccountJournal = {
  ...emptyWorkspaceE2EAccountJournal("agent-run"),
  dotyposCustomerIds: ["seeded-customer", "other-contact"],
  dotyposReservationIds: ["own-hold", "other-contact-hold"],
};

const owners = {
  authUserOwners: new Map(),
  customerOwners: new Map([
    ["seeded-customer", recipient],
    ["other-contact", otherContact],
  ]),
  journal,
  recipientEmails: new Set([recipient]),
  reservationOwners: new Map([
    ["own-hold", recipient],
    ["other-contact-hold", otherContact],
  ]),
};

const evidence = (
  reservations: { owned?: string[]; settled?: string[] },
  customers: { owned?: string[]; settled?: string[] } = {}
) => ({
  dotyposCustomerIds: {
    ownedIds: new Set(customers.owned),
    settledIds: new Set(customers.settled),
  },
  dotyposReservationIds: {
    ownedIds: new Set(reservations.owned),
    settledIds: new Set(reservations.settled),
  },
});

describe("validateWorkspaceE2EAccountLaneJournalOwnership", () => {
  test("refuses another contact's resources without evidence", () => {
    expect(() =>
      validateWorkspaceE2EAccountLaneJournalOwnership(owners)
    ).toThrow("ownership mismatch");
  });

  test("keeps another contact's resources the owner proves it created", () => {
    expect(
      validateWorkspaceE2EAccountLaneJournalOwnership({
        ...owners,
        evidence: evidence(
          { owned: ["other-contact-hold"] },
          { owned: ["other-contact"] }
        ),
      })
    ).toMatchObject({
      dotyposCustomerIds: ["seeded-customer", "other-contact"],
      dotyposReservationIds: ["own-hold", "other-contact-hold"],
    });
  });

  test("drops settled resources it can no longer prove, without touching them", () => {
    expect(
      validateWorkspaceE2EAccountLaneJournalOwnership({
        ...owners,
        evidence: evidence(
          { settled: ["other-contact-hold"] },
          { settled: ["other-contact"] }
        ),
      })
    ).toMatchObject({
      dotyposCustomerIds: ["seeded-customer"],
      dotyposReservationIds: ["own-hold"],
    });
  });

  test("still refuses an unproven resource when another one is proven", () => {
    expect(() =>
      validateWorkspaceE2EAccountLaneJournalOwnership({
        ...owners,
        evidence: evidence({ owned: ["other-contact-hold"] }),
      })
    ).toThrow("ownership mismatch");
  });
});
