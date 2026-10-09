import { expect, test } from "bun:test";
import type {
  DotyposCustomerId,
  DotyposReservationId,
} from "@deskohub/dotypos";
import { ExternalAPIError } from "@deskohub/dotypos";
import type { Customer } from "@deskohub/dotypos/generated";
import { Effect } from "effect";
import {
  emptyWorkspaceE2EAccountJournal,
  parseWorkspaceE2EAccountJournal,
} from "../account/journal";
import {
  prepareWorkspaceE2EAccountLaneReconciliation,
  validateWorkspaceE2EAccountLaneJournalOwnership,
  type WorkspaceE2EAccountLaneReconciliation,
} from "../account/reconcile";
import {
  type PreparedCheckoutFlowCleanup,
  prepareCheckoutFlowCleanup,
} from "../cleanup";
import type { DatasourceConfig } from "../config";
import { workspaceE2EError } from "../errors";
import { E2EDatabase } from "../integrations/database.service";
import type { WorkspaceE2ERunId } from "../run-identifiers";
import type { CheckoutData, CheckoutFlowState, CheckoutRow } from "../types";
import {
  type E2ETelemetryObservation,
  makeE2ETelemetryMock,
} from "../services/telemetry.mock";
import {
  runWorkspaceE2ECleanupWithPreparedCandidates,
  traceWorkspaceE2ESuiteCleanup,
} from "./cleanup-plan";

test("records a failed suite-cleanup phase after reconciling the account lane", async () => {
  const observations: E2ETelemetryObservation[] = [];
  const checkoutError = workspaceE2EError(
    "wait for Dotypos cancellation convergence failed"
  );
  let accountLaneReconciled = false;

  const exit = await Effect.runPromiseExit(
    traceWorkspaceE2ESuiteCleanup({
      cleanupCheckout: Effect.succeed(checkoutError),
      reconcileAccountLane: Effect.sync(() => {
        accountLaneReconciled = true;
      }),
    }).pipe(Effect.provide(makeE2ETelemetryMock(observations)))
  );

  expect(exit._tag).toBe("Failure");
  expect(accountLaneReconciled).toBe(true);
  expect(observations).toEqual([
    {
      failureKind: "error",
      outcome: "failed",
      phaseId: "suite-cleanup",
      scope: "phase",
    },
  ]);
});

test("records a passed suite-cleanup phase when checkout cleanup succeeds", async () => {
  const observations: E2ETelemetryObservation[] = [];

  await Effect.runPromise(
    traceWorkspaceE2ESuiteCleanup({
      cleanupCheckout: Effect.succeed(undefined),
      reconcileAccountLane: Effect.void,
    }).pipe(Effect.provide(makeE2ETelemetryMock(observations)))
  );

  expect(observations).toEqual([
    { outcome: "passed", phaseId: "suite-cleanup", scope: "phase" },
  ]);
});

test("does not start checkout cleanup when account journal validation fails", async () => {
  let checkoutCleanupStarted = false;

  await expect(
    runWorkspaceE2ECleanupWithPreparedCandidates({
      readAccountLaneJournal: async () => {
        throw new Error("invalid account lane journal");
      },
      readCheckoutCleanup: async () => emptyCheckoutCleanup(),
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
    readCheckoutCleanup: async () => emptyCheckoutCleanup(),
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
      readCheckoutCleanup: async () => emptyCheckoutCleanup(),
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

test("rejects a present account profile without email before either cleanup scope mutates", async () => {
  const journal = parseWorkspaceE2EAccountJournal(
    JSON.stringify({
      ...emptyWorkspaceE2EAccountJournal(),
      dotyposCustomerIds: ["present-customer"],
    })
  );
  let checkoutMutationCount = 0;
  let accountMutationCount = 0;
  const readCustomerIds: string[] = [];

  const accountPreparation = prepareWorkspaceE2EAccountLaneReconciliation(
    {} as DatasourceConfig,
    "source-run" as WorkspaceE2ERunId,
    {
      readJournal: async () => journal,
      findAuthUserEmailById: () => Effect.succeed(undefined),
      readSyntheticCustomerProfile: (_config, customerId) => {
        readCustomerIds.push(customerId);
        return Effect.succeed({
          _cloudId: "synthetic-cloud",
          deleted: false,
          display: true,
          id: customerId,
          flags: "",
          points: null,
        } satisfies Customer);
      },
      readReservationOwner: () =>
        Effect.succeed({ customerId: undefined, email: undefined }),
    }
  );

  await expect(
    runWorkspaceE2ECleanupWithPreparedCandidates({
      readAccountLaneJournal: () =>
        Effect.runPromise(
          accountPreparation.pipe(
            Effect.provideService(
              E2EDatabase,
              E2EDatabase.of({ db: {} as never })
            )
          )
        ),
      readCheckoutCleanup: async () => emptyCheckoutCleanup(),
      reconcile: async () => {
        checkoutMutationCount += 1;
        accountMutationCount += 1;
      },
    })
  ).rejects.toThrow(
    "Workspace account e2e journal ownership validation failed"
  );

  expect(checkoutMutationCount).toBe(0);
  expect(accountMutationCount).toBe(0);
  expect(readCustomerIds).toEqual(["present-customer"]);
});

test("does not treat a present account reservation with a missing customer as absent", async () => {
  const journal = parseWorkspaceE2EAccountJournal(
    JSON.stringify({
      ...emptyWorkspaceE2EAccountJournal(),
      dotyposReservationIds: ["present-reservation"],
    })
  );
  const customerReadError = workspaceE2EError(
    "read reservation customer failed",
    {
      cause: new ExternalAPIError({
        operation: "getCustomer",
        service: "Dotypos",
        statusCode: 404,
      }),
      operation: "read account reservation owner",
    }
  );
  let mutationCount = 0;
  const accountPreparation = prepareWorkspaceE2EAccountLaneReconciliation(
    {} as DatasourceConfig,
    "source-run" as WorkspaceE2ERunId,
    {
      readJournal: async () => journal,
      findAuthUserEmailById: () => Effect.succeed(undefined),
      readSyntheticCustomerProfile: () =>
        Effect.succeed({
          _cloudId: "unused-cloud",
          deleted: false,
          display: true,
          flags: "",
          points: null,
        } satisfies Customer),
      readReservationOwner: () => Effect.fail(customerReadError),
    }
  );

  await expect(
    runWorkspaceE2ECleanupWithPreparedCandidates({
      readAccountLaneJournal: () =>
        Effect.runPromise(
          accountPreparation.pipe(
            Effect.provideService(
              E2EDatabase,
              E2EDatabase.of({ db: {} as never })
            )
          )
        ),
      readCheckoutCleanup: async () => emptyCheckoutCleanup(),
      reconcile: async () => {
        mutationCount += 1;
      },
    })
  ).rejects.toBe(customerReadError);

  expect(mutationCount).toBe(0);
});

test("does not mutate either cleanup scope when checkout ownership preparation fails", async () => {
  let checkoutMutationCount = 0;
  let accountMutationCount = 0;

  await expect(
    runWorkspaceE2ECleanupWithPreparedCandidates({
      readAccountLaneJournal: async () => undefined,
      readCheckoutCleanup: async () => {
        throw new Error(
          "Workspace checkout cleanup recipient ownership mismatch"
        );
      },
      reconcile: async () => {
        checkoutMutationCount += 1;
        accountMutationCount += 1;
      },
    })
  ).rejects.toThrow("Workspace checkout cleanup recipient ownership mismatch");

  expect(checkoutMutationCount).toBe(0);
  expect(accountMutationCount).toBe(0);
});

test("rejects an unrelated fallback owner before checkout or account mutation", async () => {
  const exactOrderData = {
    date: "2026-08-04",
    email: "delivered+source-checkout@resend.dev",
    expectedReservationDetails: {
      kind: "cowork",
      entryTier: "basic",
      coffee: false,
    },
    locale: "en-US",
  } as CheckoutData;
  const fallbackData = {
    ...exactOrderData,
    email: "delivered+fallback-checkout@resend.dev",
  };
  const exactOrderState: CheckoutFlowState = {
    data: exactOrderData,
    orderId: "source-order" as CheckoutFlowState["orderId"],
    startedAt: new Date("2026-07-26T12:00:00.000Z"),
  };
  const fallbackState: CheckoutFlowState = {
    data: fallbackData,
    startedAt: new Date("2026-07-26T12:00:01.000Z"),
  };
  const exactOrderRow = {
    reservation_id: exactOrderState.orderId,
    dotypos_customer_id: "source-customer" as DotyposCustomerId,
    dotypos_reservation_id: "source-reservation" as DotyposReservationId,
  } as CheckoutRow;
  const unrelatedFallbackRow = {
    reservation_id: "unrelated-order",
    dotypos_customer_id: "foreign-customer" as DotyposCustomerId,
    dotypos_reservation_id: "foreign-reservation" as DotyposReservationId,
  } as CheckoutRow;
  let checkoutMutationCount = 0;
  let accountMutationCount = 0;
  let cancellationCount = 0;
  const checkoutPreparation = prepareCheckoutFlowCleanup(
    {
      datasourceConfig: {} as DatasourceConfig,
      flowStates: [exactOrderState, fallbackState],
    },
    {
      cancelDotyposReservation: () =>
        Effect.sync(() => {
          cancellationCount += 1;
        }),
      readCheckoutRow: () => Effect.succeed(exactOrderRow),
      readCleanupCheckoutRows: () => Effect.succeed([unrelatedFallbackRow]),
      readDotyposReservationOwner: (_config, reservationId) =>
        Effect.succeed(
          reservationId === exactOrderRow.dotypos_reservation_id
            ? {
                customerId: "source-customer" as DotyposCustomerId,
                email: exactOrderData.email,
              }
            : {
                customerId: "foreign-customer" as DotyposCustomerId,
                email: "delivered+other-run@resend.dev",
              }
        ),
    }
  );

  await expect(
    runWorkspaceE2ECleanupWithPreparedCandidates({
      readAccountLaneJournal: async () => undefined,
      readCheckoutCleanup: () =>
        Effect.runPromise(
          checkoutPreparation.pipe(
            Effect.provideService(
              E2EDatabase,
              E2EDatabase.of({ db: {} as never })
            )
          )
        ),
      reconcile: async () => {
        checkoutMutationCount += 1;
        accountMutationCount += 1;
      },
    })
  ).rejects.toThrow("Workspace checkout cleanup recipient ownership mismatch");

  expect(checkoutMutationCount).toBe(0);
  expect(accountMutationCount).toBe(0);
  expect(cancellationCount).toBe(0);
});

const emptyCheckoutCleanup = (): PreparedCheckoutFlowCleanup => ({
  checkoutRows: [],
  completedReservationIds: new Set<DotyposReservationId>(),
  flowStates: [],
});
