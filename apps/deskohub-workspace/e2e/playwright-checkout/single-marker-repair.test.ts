import { describe, expect, test } from "bun:test";
import {
  assertSingleMarkerRepairAccountPostconditions,
  assertSingleMarkerRepairSourceOwnership,
  prepareSingleMarkerRepairPlan,
  runSingleMarkerRepair,
  type SingleMarkerRepairAccountJournalIdentity,
  type SingleMarkerRepairSourceMarker,
} from "./single-marker-repair";
import { hashWorkspaceE2ECandidateIds } from "./source-candidate-set";

const makeFixture = () => {
  const sourceMarkers = Array.from({ length: 36 }, (_, index) => ({
    caseId: `case-${index}`,
    expectedEmail: `synthetic-${index}@example.test`,
    orderId: `order-${index}`,
    reservationId: `reservation-${index}`,
  })) satisfies readonly SingleMarkerRepairSourceMarker[];
  const candidateIds = [
    ...sourceMarkers.map(({ reservationId }) => reservationId),
    "reservation-extra-1",
    "reservation-extra-2",
  ];
  const statusByCandidateId = new Map(
    candidateIds.map((id) => [
      id,
      id === "reservation-0" ? "CONFIRMED" : "CANCELLED",
    ])
  );
  return {
    sourceMarkers,
    candidateIds,
    expectedCandidateSetSha256: hashWorkspaceE2ECandidateIds(candidateIds),
    statusByCandidateId,
    activeInventory: [{ reservationId: "reservation-0", status: "CONFIRMED" }],
  };
};

describe("prepareSingleMarkerRepairPlan", () => {
  test("admits one confirmed source marker and leaves 37 cancelled candidates untouched", () => {
    const fixture = makeFixture();

    expect(prepareSingleMarkerRepairPlan(fixture)).toMatchObject({
      target: fixture.sourceMarkers[0],
      candidateCount: 38,
      sourceMarkerCount: 36,
      cancelledBeforeRepair: 37,
      confirmedBeforeRepair: 1,
      activeBeforeRepair: 1,
    });
  });

  test.each([
    {
      name: "a NEW candidate",
      change: (fixture: ReturnType<typeof makeFixture>) =>
        fixture.statusByCandidateId.set("reservation-extra-1", "NEW"),
    },
    {
      name: "two CONFIRMED candidates",
      change: (fixture: ReturnType<typeof makeFixture>) =>
        fixture.statusByCandidateId.set("reservation-extra-1", "CONFIRMED"),
    },
    {
      name: "an active candidate other than the source marker",
      change: (fixture: ReturnType<typeof makeFixture>) =>
        fixture.activeInventory.push({
          reservationId: "reservation-extra-1",
          status: "CANCELLED",
        }),
    },
    {
      name: "a confirmed detail with NEW inventory status",
      change: (fixture: ReturnType<typeof makeFixture>) => {
        fixture.activeInventory[0] = {
          reservationId: "reservation-0",
          status: "NEW",
        };
      },
    },
    {
      name: "a confirmed detail with CANCELLED inventory status",
      change: (fixture: ReturnType<typeof makeFixture>) => {
        fixture.activeInventory[0] = {
          reservationId: "reservation-0",
          status: "CANCELLED",
        };
      },
    },
    {
      name: "a source marker absent from the candidate set",
      change: (fixture: ReturnType<typeof makeFixture>) =>
        fixture.candidateIds.pop(),
    },
  ])("fails closed for $name", ({ change }) => {
    const fixture = makeFixture();
    change(fixture);

    expect(() => prepareSingleMarkerRepairPlan(fixture)).toThrow(
      "single_marker_repair"
    );
  });

  test("rejects a same-count candidate replacement against the source anchor", () => {
    const fixture = makeFixture();
    fixture.candidateIds[36] = "reservation-replacement";
    fixture.statusByCandidateId.delete("reservation-extra-1");
    fixture.statusByCandidateId.set("reservation-replacement", "CANCELLED");

    expect(fixture.candidateIds).toHaveLength(38);
    expect(() => prepareSingleMarkerRepairPlan(fixture)).toThrow(
      "single_marker_repair_candidate_set_mismatch"
    );
  });
});

describe("workspace E2E candidate-set hash", () => {
  test("uses the sorted unique set and changes for a same-count replacement", () => {
    const candidateIds = Array.from(
      { length: 38 },
      (_, index) => `synthetic-reservation-${index}`
    );
    const replacement = [
      ...candidateIds.slice(0, -1),
      "synthetic-reservation-replacement",
    ];

    expect(hashWorkspaceE2ECandidateIds(candidateIds)).toBe(
      hashWorkspaceE2ECandidateIds([...candidateIds].reverse())
    );
    expect(hashWorkspaceE2ECandidateIds(candidateIds)).toBe(
      hashWorkspaceE2ECandidateIds([...candidateIds, candidateIds[0]!])
    );
    expect(replacement).toHaveLength(candidateIds.length);
    expect(hashWorkspaceE2ECandidateIds(replacement)).not.toBe(
      hashWorkspaceE2ECandidateIds(candidateIds)
    );
  });
});

describe("assertSingleMarkerRepairSourceOwnership", () => {
  const marker = makeFixture().sourceMarkers[0]!;

  test("accepts the exact source state, checkout row, reservation, and customer", () => {
    expect(() =>
      assertSingleMarkerRepairSourceOwnership({
        marker,
        checkoutRow: {
          customerId: "customer-0",
          orderId: "order-0",
          reservationId: "reservation-0",
        },
        reservation: {
          customerEmail: marker.expectedEmail,
          customerId: "customer-0",
          reservationId: "reservation-0",
        },
        customer: {
          customerId: "customer-0",
          email: marker.expectedEmail,
        },
      })
    ).not.toThrow();
  });

  test("rejects a provider customer that does not match the exact source row", () => {
    expect(() =>
      assertSingleMarkerRepairSourceOwnership({
        marker,
        checkoutRow: {
          customerId: "customer-0",
          orderId: "order-0",
          reservationId: "reservation-0",
        },
        reservation: {
          customerEmail: marker.expectedEmail,
          customerId: "customer-other",
          reservationId: "reservation-0",
        },
        customer: {
          customerId: "customer-0",
          email: marker.expectedEmail,
        },
      })
    ).toThrow("single_marker_repair_provider_reservation_customer_id_mismatch");
  });

  test("returns closed ownership field codes without embedding source values", () => {
    const failure = (() => {
      try {
        assertSingleMarkerRepairSourceOwnership({
          marker,
          checkoutRow: {
            customerId: "synthetic-customer-id",
            orderId: marker.orderId,
            reservationId: marker.reservationId,
          },
          reservation: {
            customerEmail: marker.expectedEmail,
            customerId: null,
            reservationId: marker.reservationId,
          },
          customer: undefined,
        });
      } catch (error) {
        return error;
      }
      throw new Error("Expected ownership failure");
    })();

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(
      "single_marker_repair_provider_reservation_customer_id_missing"
    );
    expect((failure as Error).message).not.toContain("synthetic-customer-id");
    expect((failure as Error).message).not.toContain(marker.expectedEmail);
  });
});

describe("runSingleMarkerRepair", () => {
  test("cancels exactly the confirmed marker and skips 37 cancelled candidates", async () => {
    const fixture = makeFixture();
    const plan = prepareSingleMarkerRepairPlan(fixture);
    const events: string[] = [];

    const result = await runSingleMarkerRepair({
      plan,
      candidateIds: fixture.candidateIds,
      assertTargetOwnership: async () => {
        events.push("ownership");
      },
      cancelTarget: async (target) => {
        events.push(`cancel:${target.reservationId}`);
      },
      convergeAllCandidates: async (candidateIds) => {
        expect(candidateIds).toHaveLength(38);
        events.push("converge");
      },
      reconcileAccountLane: async () => {
        events.push("reconcile");
      },
      assertAccountPostconditions: async () => {
        events.push("postconditions");
        return "verified";
      },
    });

    expect(events).toEqual([
      "ownership",
      "cancel:reservation-0",
      "converge",
      "reconcile",
      "postconditions",
    ]);
    expect(result).toEqual({
      cancelledReservationCount: 1,
      skippedCancelledCandidateCount: 37,
      accountPostconditions: "verified",
    });
  });

  test("does not reconcile the account lane when checkout convergence fails", async () => {
    const fixture = makeFixture();
    const plan = prepareSingleMarkerRepairPlan(fixture);
    let reconcileCalled = false;

    await expect(
      runSingleMarkerRepair({
        plan,
        candidateIds: fixture.candidateIds,
        assertTargetOwnership: async () => {},
        cancelTarget: async () => {},
        convergeAllCandidates: async () => {
          throw new Error("convergence failed");
        },
        reconcileAccountLane: async () => {
          reconcileCalled = true;
        },
        assertAccountPostconditions: async () => {},
      })
    ).rejects.toThrow("convergence failed");

    expect(reconcileCalled).toBe(false);
  });

  test("does not cancel when target ownership fails", async () => {
    const fixture = makeFixture();
    const plan = prepareSingleMarkerRepairPlan(fixture);
    let cancelCalled = false;

    await expect(
      runSingleMarkerRepair({
        plan,
        candidateIds: fixture.candidateIds,
        assertTargetOwnership: async () => {
          throw new Error("ownership failed");
        },
        cancelTarget: async () => {
          cancelCalled = true;
        },
        convergeAllCandidates: async () => {},
        reconcileAccountLane: async () => {},
        assertAccountPostconditions: async () => {},
      })
    ).rejects.toThrow("ownership failed");

    expect(cancelCalled).toBe(false);
  });
});

describe("assertSingleMarkerRepairAccountPostconditions", () => {
  const originalJournal: SingleMarkerRepairAccountJournalIdentity = {
    authUserIds: ["auth-user"],
    completed: false,
    dotyposCustomerIds: ["customer"],
    dotyposReservationIds: [],
  };

  test("requires the completed journal, preserved source arrays, and persisted cleanup state", () => {
    expect(() =>
      assertSingleMarkerRepairAccountPostconditions({
        originalJournal,
        completedJournal: { ...originalJournal, completed: true },
        remainingAuthUsers: 0,
        remainingAuthSessions: 0,
        remainingAuthAccounts: 0,
        remainingCustomerLinks: 0,
        expiredRetainedCustomers: 1,
      })
    ).not.toThrow();
  });

  test("rejects surviving identity rows, links, or an unexpired retained profile", () => {
    expect(() =>
      assertSingleMarkerRepairAccountPostconditions({
        originalJournal,
        completedJournal: { ...originalJournal, completed: true },
        remainingAuthUsers: 0,
        remainingAuthSessions: 0,
        remainingAuthAccounts: 1,
        remainingCustomerLinks: 0,
        expiredRetainedCustomers: 0,
      })
    ).toThrow("single_marker_repair_account_postconditions_failed");
  });
});
