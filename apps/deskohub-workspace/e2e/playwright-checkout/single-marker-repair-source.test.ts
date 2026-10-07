import { describe, expect, test } from "bun:test";
import { emptyWorkspaceE2EAccountJournal } from "../account/journal";
import type { WorkspaceE2EAccountLaneReconciliation } from "../account/reconcile";
import type {
  SingleMarkerRepairCheckoutRow,
  SingleMarkerRepairSourceCheckoutPreparation,
  SingleMarkerRepairSourceState,
} from "./single-marker-repair-source";
import {
  makeSingleMarkerRepairSourcePreflightReceipt,
  prepareSingleMarkerRepairSource,
} from "./single-marker-repair-source";
import { hashWorkspaceE2ECandidateIds } from "./source-candidate-set";

const makeFixture = () => {
  const journalStates = Array.from({ length: 36 }, (_, index) => ({
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
  const sourceRows = journalStates.map(({ state }) => ({
    reservation_id: state.orderId as string,
    dotypos_customer_id: "synthetic-customer",
    dotypos_reservation_id: state.completedDotyposReservationId as string,
  })) satisfies readonly SingleMarkerRepairCheckoutRow[];
  const fallbackRows = [
    {
      reservation_id: "fallback-order-a",
      dotypos_customer_id: "synthetic-customer",
      dotypos_reservation_id: "fallback-reservation-a",
    },
    {
      reservation_id: "fallback-order-b",
      dotypos_customer_id: "synthetic-customer",
      dotypos_reservation_id: "fallback-reservation-b",
    },
  ] satisfies readonly SingleMarkerRepairCheckoutRow[];
  const candidates = [
    ...journalStates.map(
      ({ state }) => state.completedDotyposReservationId as string
    ),
    ...fallbackRows.map((row) => row.dotypos_reservation_id as string),
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
  const checkoutCleanup: SingleMarkerRepairSourceCheckoutPreparation = {
    journalStates,
    checkoutRows: [...sourceRows, ...fallbackRows],
    orderRows: sourceRows.map((row) => [row.reservation_id, row] as const),
  };
  return {
    accountLane,
    candidates,
    checkoutCleanup,
    fallbackRows,
    sourceRows,
    expectedCandidateSetSha256: hashWorkspaceE2ECandidateIds(candidates),
  };
};

const runPreflight = (
  fixture: ReturnType<typeof makeFixture>,
  overrides: {
    readonly readAccountLane?: () => Promise<
      WorkspaceE2EAccountLaneReconciliation | undefined
    >;
    readonly readCheckoutCleanup?: () => Promise<SingleMarkerRepairSourceCheckoutPreparation>;
    readonly expectedCandidateSetSha256?: string;
  } = {}
) =>
  prepareSingleMarkerRepairSource({
    expectedCandidateSetSha256:
      overrides.expectedCandidateSetSha256 ??
      fixture.expectedCandidateSetSha256,
    readAccountLane:
      overrides.readAccountLane ?? (() => Promise.resolve(fixture.accountLane)),
    readCheckoutCleanup:
      overrides.readCheckoutCleanup ??
      (() => Promise.resolve(fixture.checkoutCleanup)),
  });

const receiptSource = {
  artifactCleanupManifestSha256: "a".repeat(64),
  artifactFileCount: 36,
  codeRef: "synthetic-code-ref",
  codeSha: "b".repeat(40),
  executionRunAttempt: 1,
  executionRunId: "123456",
  neonBranchIdSha256: "c".repeat(64),
  prNumber: 464,
  runId: "synthetic-source-run-1",
  targetRef: "synthetic-target-ref",
  targetSha: "d".repeat(40),
  targetUrl: "https://synthetic-preview.example.test",
} as const;

describe("prepareSingleMarkerRepairSource", () => {
  test("unions source markers with already ownership-prepared cleanup rows", async () => {
    const fixture = makeFixture();
    const result = await runPreflight(fixture);

    expect(result.outcome).toBe("ready");
    if (result.outcome !== "ready") {
      throw new Error("Expected source preflight");
    }
    expect(result.counts).toMatchObject({
      accountLanePresent: true,
      accountReservationCandidateCount: 0,
      sourceStateCount: 36,
      completedMarkerCount: 36,
      exactOrderRowReadCount: 36,
      candidateCount: 38,
      sourceMarkerRowReservationMismatchCount: 0,
    });
    expect(result.candidateIdSetSha256).toBe(
      fixture.expectedCandidateSetSha256
    );
    expect(result.otherCandidateIds.size).toBe(2);

    const receipt = makeSingleMarkerRepairSourcePreflightReceipt({
      preflight: result,
      startedAt: "2026-10-01T00:00:00.000Z",
      completedAt: "2026-10-01T00:00:01.000Z",
      source: receiptSource,
    });
    const serialized = JSON.stringify(receipt);
    expect(serialized).not.toContain("synthetic-auth-user");
    expect(serialized).not.toContain("synthetic-customer");
    expect(serialized).not.toContain("source-marker-");
    expect(serialized).not.toContain("source-order-");
    expect(serialized).not.toContain("@example.test");
    expect(serialized).not.toContain("fallback-reservation-");
  });

  test("rejects a 36-marker-only set against the pinned 38-candidate scope", async () => {
    const fixture = makeFixture();
    const result = await runPreflight(fixture, {
      readCheckoutCleanup: () =>
        Promise.resolve({
          ...fixture.checkoutCleanup,
          checkoutRows: fixture.sourceRows,
        }),
    });

    expect(result).toMatchObject({
      outcome: "failed",
      reason: "candidate_count_mismatch",
      counts: { completedMarkerCount: 36, candidateCount: 36 },
    });
  });

  test("rejects a same-count replacement of an ownership-prepared fallback row", async () => {
    const fixture = makeFixture();
    const replacementRows = [
      fixture.fallbackRows[0],
      {
        ...fixture.fallbackRows[1],
        dotypos_reservation_id: "replacement-reservation",
      },
    ];
    const result = await runPreflight(fixture, {
      readCheckoutCleanup: () =>
        Promise.resolve({
          ...fixture.checkoutCleanup,
          checkoutRows: [...fixture.sourceRows, ...replacementRows],
        }),
    });

    expect(result).toMatchObject({
      outcome: "failed",
      reason: "candidate_set_mismatch",
      counts: { candidateCount: 38 },
    });
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
      source: receiptSource,
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

  test("classifies cleanup preparation failure without exposing its error", async () => {
    const fixture = makeFixture();
    const result = await runPreflight(fixture, {
      readCheckoutCleanup: async () => {
        throw new Error("synthetic private database detail");
      },
    });

    expect(result).toMatchObject({
      outcome: "failed",
      reason: "checkout_cleanup_preparation_failed",
    });
    expect(JSON.stringify(result)).not.toContain("private database detail");
  });

  test("keeps prepared order rows optional and maps duplicate journal orders", async () => {
    const fixture = makeFixture();
    const journalStates = fixture.checkoutCleanup.journalStates.map(
      (entry, index) => {
        if (index === 2) {
          return { ...entry, state: { ...entry.state, orderId: undefined } };
        }
        if (index === 3) {
          return {
            ...entry,
            state: { ...entry.state, orderId: "source-order-4" },
          };
        }
        return entry;
      }
    );
    const orderRows = fixture.checkoutCleanup.orderRows.map(
      ([orderId, row]) => {
        if (orderId === "source-order-2") return [orderId, undefined] as const;
        if (orderId === "source-order-5") {
          return [
            orderId,
            {
              ...row,
              reservation_id: "different-order",
              dotypos_customer_id: null,
              dotypos_reservation_id: null,
            },
          ] as const;
        }
        return [orderId, row] as const;
      }
    );
    const result = await runPreflight(fixture, {
      readCheckoutCleanup: () =>
        Promise.resolve({
          ...fixture.checkoutCleanup,
          journalStates,
          orderRows,
        }),
    });

    expect(result.outcome).toBe("ready");
    if (result.outcome !== "ready") {
      throw new Error("Expected source preflight");
    }
    expect(result.counts).toMatchObject({
      candidateCount: 38,
      exactOrderRowMissingCount: 1,
      missingOrderIdCount: 1,
      sourceMarkerRowReservationMismatchCount: 2,
      uniqueOrderIdCount: 34,
    });
  });
});
