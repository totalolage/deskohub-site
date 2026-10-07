import { describe, expect, test } from "bun:test";
import { emptyWorkspaceE2EAccountJournal } from "../account/journal";
import type { WorkspaceE2EAccountLaneReconciliation } from "../account/reconcile";
import type {
  SingleMarkerRepairCheckoutRow,
  SingleMarkerRepairSourceState,
} from "./single-marker-repair-source";
import {
  makeSingleMarkerRepairSourcePreflightReceipt,
  prepareSingleMarkerRepairSource,
} from "./single-marker-repair-source";
import { hashWorkspaceE2ECandidateIds } from "./source-candidate-set";

const makeFixture = () => {
  const states = Array.from({ length: 36 }, (_, index) => ({
    caseId: `case-${index}`,
    state: {
      completedDotyposReservationId: `source-marker-${index}`,
      data: {
        email: `synthetic-${index}@example.test`,
        date: "2026-10-01",
      },
      orderId: `source-order-${index}`,
    },
  })) satisfies readonly SingleMarkerRepairSourceState[];
  const candidates = [
    ...states.map(({ state }) => state.completedDotyposReservationId as string),
    "extra-reservation-a",
    "extra-reservation-b",
  ];
  const accountJournal = emptyWorkspaceE2EAccountJournal();
  const accountLane: WorkspaceE2EAccountLaneReconciliation = {
    authUserIds: ["synthetic-auth-user"],
    dotyposCustomerIds: ["synthetic-customer"],
    dotyposReservationIds: [],
    journal: {
      ...accountJournal,
      authUserIds: ["synthetic-auth-user"],
      dotyposCustomerIds: ["synthetic-customer"],
    },
  };
  const readCheckoutRow = async (orderId: string) => {
    const index = Number(orderId.slice("source-order-".length));
    const sourceMarker = `source-marker-${index}`;
    let dotyposReservationId = sourceMarker;
    if (index === 0) dotyposReservationId = "extra-reservation-a";
    if (index === 1) dotyposReservationId = "extra-reservation-b";
    return {
      reservation_id: orderId,
      dotypos_customer_id: `synthetic-customer-${index}`,
      dotypos_reservation_id: dotyposReservationId,
    } satisfies SingleMarkerRepairCheckoutRow;
  };
  return {
    accountLane,
    candidates,
    readCheckoutRow,
    states,
    expectedCandidateSetSha256: hashWorkspaceE2ECandidateIds(candidates),
  };
};

const runPreflight = (
  fixture: ReturnType<typeof makeFixture>,
  overrides: {
    readonly readAccountLane?: () => Promise<
      WorkspaceE2EAccountLaneReconciliation | undefined
    >;
    readonly readJournalStates?: () => Promise<
      readonly SingleMarkerRepairSourceState[]
    >;
    readonly readCheckoutRow?: (
      orderId: string
    ) => Promise<SingleMarkerRepairCheckoutRow | undefined>;
  } = {}
) =>
  prepareSingleMarkerRepairSource({
    expectedCandidateSetSha256: fixture.expectedCandidateSetSha256,
    readAccountLane:
      overrides.readAccountLane ?? (() => Promise.resolve(fixture.accountLane)),
    readJournalStates:
      overrides.readJournalStates ?? (() => Promise.resolve(fixture.states)),
    readCheckoutRow: overrides.readCheckoutRow ?? fixture.readCheckoutRow,
  });

describe("prepareSingleMarkerRepairSource", () => {
  test("uses bounded exact-row reads and returns a count-only receipt", async () => {
    const fixture = makeFixture();
    let activeReads = 0;
    let maximumActiveReads = 0;
    const result = await runPreflight(fixture, {
      readCheckoutRow: async (orderId) => {
        activeReads += 1;
        maximumActiveReads = Math.max(maximumActiveReads, activeReads);
        try {
          return await fixture.readCheckoutRow(orderId);
        } finally {
          activeReads -= 1;
        }
      },
    });

    expect(result.outcome).toBe("ready");
    if (result.outcome !== "ready") {
      throw new Error("Expected source preflight");
    }
    expect(maximumActiveReads).toBeLessThanOrEqual(4);
    expect(result.counts).toMatchObject({
      accountLanePresent: true,
      accountReservationCandidateCount: 0,
      sourceStateCount: 36,
      completedMarkerCount: 36,
      exactOrderRowReadCount: 36,
      candidateCount: 38,
      sourceMarkerRowReservationMismatchCount: 2,
    });
    const receipt = makeSingleMarkerRepairSourcePreflightReceipt({
      preflight: result,
      startedAt: "2026-10-01T00:00:00.000Z",
      completedAt: "2026-10-01T00:00:01.000Z",
      source: {
        artifactCleanupManifestSha256: "a".repeat(64),
        artifactFileCount: 36,
        codeRef: "synthetic-code-ref",
        codeSha: "b".repeat(40),
        executionRunAttempt: 1,
        executionRunId: "123456",
        neonBranchIdSha256: "c".repeat(64),
        prNumber: 464,
        runId: "37580940745-1",
        targetRef: "synthetic-target-ref",
        targetSha: "d".repeat(40),
        targetUrl: "https://synthetic-preview.vercel.app",
      },
    });
    const serialized = JSON.stringify(receipt);
    expect(serialized).not.toContain("synthetic-auth-user");
    expect(serialized).not.toContain("synthetic-customer");
    expect(serialized).not.toContain("source-marker-");
    expect(serialized).not.toContain("source-order-");
    expect(serialized).not.toContain("@example.test");
    expect(serialized).not.toContain("extra-reservation-");
  });

  test("classifies account preparation without exposing the thrown error", async () => {
    const fixture = makeFixture();
    const result = await runPreflight(fixture, {
      readAccountLane: async () => {
        throw new Error("synthetic private account lookup detail");
      },
    });

    expect(result).toMatchObject({
      outcome: "failed",
      reason: "account_preparation_failed",
    });
    expect(JSON.stringify(result)).not.toContain("private account lookup");
    const receipt = makeSingleMarkerRepairSourcePreflightReceipt({
      preflight: result,
      startedAt: "2026-10-01T00:00:00.000Z",
      completedAt: "2026-10-01T00:00:01.000Z",
      source: {
        artifactCleanupManifestSha256: "a".repeat(64),
        artifactFileCount: 36,
        codeRef: "synthetic-code-ref",
        codeSha: "b".repeat(40),
        executionRunAttempt: 1,
        executionRunId: "123456",
        neonBranchIdSha256: "c".repeat(64),
        prNumber: 464,
        runId: "37580940745-1",
        targetRef: "synthetic-target-ref",
        targetSha: "d".repeat(40),
        targetUrl: "https://synthetic-preview.vercel.app",
      },
    });
    expect(receipt).toMatchObject({
      failureReason: "account_preparation_failed",
      mutation: {
        accountReconciliationStarted: false,
        cancellationAttempted: false,
        cancellationSucceeded: false,
      },
      outcome: "source_preflight_failed",
    });
  });

  test("counts exact-row query failures without exposing error text", async () => {
    const fixture = makeFixture();
    const result = await runPreflight(fixture, {
      readCheckoutRow: async (orderId) => {
        if (orderId === "source-order-0") {
          throw new Error("synthetic private database detail");
        }
        return fixture.readCheckoutRow(orderId);
      },
    });

    expect(result).toMatchObject({
      outcome: "failed",
      reason: "exact_order_row_query_failed",
      counts: {
        exactOrderRowQueryFailureCount: 1,
        exactOrderRowReadCount: 35,
      },
    });
    expect(JSON.stringify(result)).not.toContain("private database detail");
  });

  test("preserves the original optional exact-row behavior", async () => {
    const fixture = makeFixture();
    const result = await runPreflight(fixture, {
      readCheckoutRow: async (orderId) =>
        orderId === "source-order-2"
          ? undefined
          : fixture.readCheckoutRow(orderId),
    });

    expect(result).toMatchObject({
      outcome: "ready",
      counts: {
        exactOrderRowQueryFailureCount: 0,
        exactOrderRowMissingCount: 1,
      },
    });
  });

  test("does not add a returned order identity guard to optional rows", async () => {
    const fixture = makeFixture();
    const result = await runPreflight(fixture, {
      readCheckoutRow: async (orderId) => {
        const row = await fixture.readCheckoutRow(orderId);
        return orderId === "source-order-2"
          ? { ...row, reservation_id: "different-order" }
          : row;
      },
    });

    expect(result.outcome).toBe("ready");
  });

  test("matches the original candidate union despite optional row fields", async () => {
    const fixture = makeFixture();
    const journalStates = fixture.states.map((entry, index) => {
      if (index === 2)
        return { ...entry, state: { ...entry.state, orderId: undefined } };
      if (index === 3)
        return {
          ...entry,
          state: { ...entry.state, orderId: "source-order-4" },
        };
      return entry;
    });
    const readCheckoutRow = async (orderId: string) => {
      const row = await fixture.readCheckoutRow(orderId);
      if (orderId === "source-order-5") {
        return {
          ...row,
          reservation_id: "different-order",
          dotypos_customer_id: null,
          dotypos_reservation_id: null,
        };
      }
      if (orderId === "source-order-6") return undefined;
      return row;
    };
    const sourceMarkerIds = journalStates.flatMap(({ state }) =>
      state.completedDotyposReservationId
        ? [state.completedDotyposReservationId]
        : []
    );
    const orderIds = [
      ...new Set(
        journalStates.flatMap(({ state }) =>
          state.orderId ? [state.orderId] : []
        )
      ),
    ];
    const rows = await Promise.all(orderIds.map(readCheckoutRow));
    const originalCandidateIds = [
      ...new Set([
        ...sourceMarkerIds,
        ...rows.flatMap((row) =>
          row?.dotypos_reservation_id ? [row.dotypos_reservation_id] : []
        ),
      ]),
    ].toSorted();
    const result = await prepareSingleMarkerRepairSource({
      expectedCandidateSetSha256: fixture.expectedCandidateSetSha256,
      readAccountLane: () => Promise.resolve(fixture.accountLane),
      readJournalStates: () => Promise.resolve(journalStates),
      readCheckoutRow,
    });

    expect(result.outcome).toBe("ready");
    if (result.outcome !== "ready") {
      throw new Error("Expected original candidate admission");
    }
    expect(result.candidateIds).toEqual(originalCandidateIds);
    expect(result.candidateIdSetSha256).toBe(
      fixture.expectedCandidateSetSha256
    );
    expect(result.counts).toMatchObject({
      candidateCount: 38,
      exactOrderRowMissingCount: 1,
      missingOrderIdCount: 1,
      uniqueOrderIdCount: 34,
    });
  });

  test("rejects a same-count candidate replacement against the frozen digest", async () => {
    const fixture = makeFixture();
    const result = await prepareSingleMarkerRepairSource({
      expectedCandidateSetSha256: "0".repeat(64),
      readAccountLane: () => Promise.resolve(fixture.accountLane),
      readJournalStates: () => Promise.resolve(fixture.states),
      readCheckoutRow: fixture.readCheckoutRow,
    });

    expect(result).toMatchObject({
      outcome: "failed",
      reason: "candidate_set_mismatch",
      counts: { candidateCount: 38 },
    });
  });
});
