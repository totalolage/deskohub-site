import { describe, expect, test } from "bun:test";
import type { Customer } from "@deskohub/dotypos/generated";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Exit } from "effect";
import type { DatasourceConfig } from "../config";
import { workspaceE2EError } from "../errors";
import { E2EDatabase } from "../integrations/database.service";
import type { WorkspaceE2ERunId } from "../run-identifiers";
import { makeWorkspaceE2EAccountRecipientForRunId } from "./config";
import {
  emptyWorkspaceE2EAccountJournal,
  type WorkspaceE2EAccountJournal,
} from "./journal";
import {
  prepareWorkspaceE2EAccountLaneReconciliation,
  reconcileWorkspaceE2EAccountJournals,
  validateWorkspaceE2EAccountLaneJournalOwnership,
  type WorkspaceE2EAccountJournalOwner,
} from "./reconcile";
import { WorkspaceE2EAccountResourceServiceMock } from "./resources.service.mock";

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

/*
 * A run's account booked a hold for another contact, whose profile Dotypos
 * created during the run. Only the reservation row the account authored
 * proves the run owns both, as `proveAgentEvalRunOwnership` reads it.
 */
const runId = "agent-run" as WorkspaceE2ERunId;
const accountId = "run-account";
const runRecipient = makeWorkspaceE2EAccountRecipientForRunId(runId, "agent");

type ReconciliationStep = "cancel" | "expire" | "remove rows";

const makeWorld = (unrelatedHold = false) => {
  const reservations = new Map([
    ["own-hold", { email: runRecipient, status: "CONFIRMED" }],
    ["other-contact-hold", { email: otherContact, status: "CONFIRMED" }],
    ...(unrelatedHold
      ? ([
          ["unrelated-hold", { email: otherContact, status: "CONFIRMED" }],
        ] as const)
      : []),
  ]);
  const customers = new Map([
    ["seeded-customer", { email: runRecipient, expired: false }],
    ["other-contact", { email: otherContact, expired: false }],
  ]);
  /* workspace_reservations rows the run's account authored, by hold. */
  const rows = new Map([
    ["own-hold", "seeded-customer"],
    ["other-contact-hold", "other-contact"],
  ]);
  const authUsers = new Map([[accountId, runRecipient]]);
  let journal: WorkspaceE2EAccountJournal = {
    ...emptyWorkspaceE2EAccountJournal(runId),
    authUserIds: [accountId],
    dotyposCustomerIds: ["seeded-customer", "other-contact"],
    dotyposReservationIds: [
      "own-hold",
      "other-contact-hold",
      ...(unrelatedHold ? ["unrelated-hold"] : []),
    ],
  };
  const cancelled: string[] = [];

  const owner: WorkspaceE2EAccountJournalOwner = {
    ownerId: runId,
    proveOwnership: (_config, journaled) =>
      Effect.sync(() => {
        const ownedReservationIds = new Set(rows.keys());
        const ownedCustomerIds = new Set(rows.values());
        return {
          dotyposCustomerIds: {
            ownedIds: ownedCustomerIds,
            settledIds: new Set(
              journaled.dotyposCustomerIds.filter(
                (id) => !ownedCustomerIds.has(id) && customers.get(id)?.expired
              )
            ),
          },
          dotyposReservationIds: {
            ownedIds: ownedReservationIds,
            settledIds: new Set(
              journaled.dotyposReservationIds.filter(
                (id) =>
                  !ownedReservationIds.has(id) &&
                  reservations.get(id)?.status === "CANCELLED"
              )
            ),
          },
        };
      }),
    recipientLabels: ["agent"],
  };

  const resources = (failing?: ReconciliationStep) => {
    const fail = (step: ReconciliationStep) =>
      Effect.fail(workspaceE2EError(`synthetic ${step} failure`));
    return WorkspaceE2EAccountResourceServiceMock({
      cancelReservations: (ids) =>
        failing === "cancel"
          ? fail("cancel")
          : Effect.sync(() => {
              for (const id of ids) {
                const reservation = reservations.get(id);
                if (reservation) reservation.status = "CANCELLED";
                cancelled.push(id);
              }
            }),
      expireProfile: (id) =>
        failing === "expire"
          ? fail("expire")
          : Effect.sync(() => {
              const customer = customers.get(id);
              if (customer) customer.expired = true;
            }),
      readAuthUserEmail: (id) => Effect.succeed(authUsers.get(id)),
      readCustomerProfile: (id) =>
        Effect.succeed({
          _cloudId: "synthetic-cloud",
          deleted: false,
          display: true,
          email: customers.get(id)?.email,
          expireDate: customers.get(id)?.expired
            ? new Date(0).toISOString()
            : undefined,
          flags: "",
          id,
          points: null,
        } as Customer),
      readJournal: () => Effect.sync(() => journal),
      readReservationOwner: (id) =>
        Effect.succeed(reservations.get(id)?.email ?? null),
      removeAuthUser: (id) => Effect.sync(() => void authUsers.delete(id)),
      removeRows: ({ syntheticDotyposReservationIds }) =>
        failing === "remove rows"
          ? fail("remove rows")
          : Effect.sync(() => {
              for (const id of syntheticDotyposReservationIds) rows.delete(id);
            }),
      writeJournal: (completed) =>
        Effect.sync(() => {
          journal = completed;
        }),
    });
  };

  /* One suite-cleanup pass: prepare the journal, then reconcile it. */
  const reconcile = (failing?: ReconciliationStep) =>
    Effect.runPromiseExit(
      prepareWorkspaceE2EAccountLaneReconciliation(
        {} as DatasourceConfig,
        runId,
        owner
      ).pipe(
        Effect.flatMap((prepared) =>
          reconcileWorkspaceE2EAccountJournals(prepared ? [prepared] : [])
        ),
        Effect.provide(resources(failing)),
        Effect.provideService(E2EDatabase, E2EDatabase.of({ db: {} as never }))
      )
    );

  return {
    cancelled,
    customers,
    journal: () => journal,
    reconcile,
    reservations,
    rows,
  };
};

describe("reconcileWorkspaceE2EAccountJournals", () => {
  for (const failing of ["cancel", "expire", "remove rows"] as const) {
    test(`retries another contact's resources after a failed ${failing} step`, async () => {
      const world = makeWorld();

      expect(Exit.isFailure(await world.reconcile(failing))).toBe(true);
      expect(world.journal().completed).toBe(false);

      const retry = await world.reconcile();
      expect(Exit.isFailure(retry) ? String(retry.cause) : "reconciled").toBe(
        "reconciled"
      );
      expect(world.reservations.get("other-contact-hold")?.status).toBe(
        "CANCELLED"
      );
      expect(world.reservations.get("own-hold")?.status).toBe("CANCELLED");
      expect(world.customers.get("other-contact")?.expired).toBe(true);
      expect(world.customers.get("seeded-customer")?.expired).toBe(true);
      expect([...world.rows.keys()]).toEqual([]);
      expect(world.journal().completed).toBe(true);

      expect(Exit.isSuccess(await world.reconcile())).toBe(true);
    });
  }

  test("keeps the authorship rows while a provider step fails", async () => {
    const world = makeWorld();

    await world.reconcile("cancel");

    expect([...world.rows.keys()]).toEqual(["own-hold", "other-contact-hold"]);
  });

  test("still refuses an unrelated journaled hold, before and after a failed pass", async () => {
    const world = makeWorld(true);

    const first = await world.reconcile();
    expect(String(Exit.isFailure(first) && first.cause)).toContain(
      "ownership validation failed"
    );

    world.rows.delete("other-contact-hold");
    const repeat = await world.reconcile();
    expect(String(Exit.isFailure(repeat) && repeat.cause)).toContain(
      "ownership validation failed"
    );
    expect(world.cancelled).toEqual([]);
    expect(world.reservations.get("unrelated-hold")?.status).toBe("CONFIRMED");
  });
});
