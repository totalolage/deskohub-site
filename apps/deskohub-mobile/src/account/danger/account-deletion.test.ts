import { describe, expect, test } from "bun:test";
import type { CustomerAccountState } from "@deskohub/workspace-customer-api";
import { Effect, Option } from "effect";
import { AsyncResult, AtomRegistry } from "effect/unstable/reactivity";
import { accountAtom } from "../../customer-api/customer-data-runtime";
import {
  makeFakeCustomerData,
  settle,
} from "../../customer-api/testing/customer-data-test-registry";
import type { FakeWorkspace } from "../../customer-api/testing/fake-workspace";
import type { SampleAccountKind } from "../../customer-api/testing/sample-fixtures";
import {
  dangerZoneView,
  deletionAttemptOf,
  deletionFollowUp,
  deletionOffer,
  deletionSubmittable,
  requestAccountDeletionAtom,
} from "./account-deletion";

/** Reads the account, as the screen does before the customer can delete. */
const openDangerZone = async (
  kind: SampleAccountKind = "linked",
  arrange?: (workspace: FakeWorkspace) => void
) => {
  const fake = makeFakeCustomerData(kind);
  arrange?.(fake.workspace);
  fake.registry.mount(accountAtom);
  const account = await settle(fake.registry, accountAtom);
  if (account._tag !== "Success") throw new Error("account didn't load");
  return { ...fake, account: account.success };
};

/** Presses "Delete permanently" and resolves with the attempt's outcome. */
const deleteAccount = async (registry: AtomRegistry.AtomRegistry) => {
  registry.mount(requestAccountDeletionAtom);
  registry.set(requestAccountDeletionAtom, undefined);
  return deletionAttemptOf(
    await Effect.runPromiseExit(
      AtomRegistry.getResult(requestAccountDeletionAtom, {
        suspendOnWaiting: true,
      })(registry)
    )
  );
};

/** The account after the attempt's refetch (if any) settles. */
const accountAfter = async (registry: AtomRegistry.AtomRegistry) => {
  const account = await settle(registry, accountAtom);
  if (account._tag !== "Success") throw new Error("account didn't reload");
  return account.success;
};

const withDeletion = (
  account: CustomerAccountState,
  deletion: CustomerAccountState["deletion"]
) => ({ ...account, deletion }) as CustomerAccountState;

describe("deletionOffer", () => {
  test("offers deletion while the API offers it", async () => {
    const { account } = await openDangerZone("linked");
    expect(deletionOffer(account)).toBe("offered");
  });

  test("offers a retry while deletion is pending", async () => {
    const { account } = await openDangerZone("deletion-pending");
    expect(deletionOffer(account)).toBe("pending");
  });

  test("offers nothing while the API withholds deletion", async () => {
    const { account } = await openDangerZone("linked", (workspace) =>
      workspace.setAccount(withDeletion(workspace.data.account, "withheld"))
    );
    expect(deletionOffer(account)).toBe("withheld");
  });

  test("never offers a review account deletion, even reached directly", async () => {
    const { account } = await openDangerZone("review-account", (workspace) =>
      workspace.setAccount(withDeletion(workspace.data.account, "offered"))
    );
    expect(deletionOffer(account)).toBe("withheld");
    expect(
      dangerZoneView(account, { confirmed: true, attempt: undefined })
        .deleteAction
    ).toBe("hidden");
  });
});

describe("dangerZoneView", () => {
  test("enables deleting only once the customer has confirmed", async () => {
    const { account } = await openDangerZone("linked");
    expect(
      dangerZoneView(account, { confirmed: false, attempt: undefined })
        .deleteAction
    ).toBe("disabled");
    expect(
      dangerZoneView(account, { confirmed: true, attempt: undefined })
        .deleteAction
    ).toBe("enabled");
  });

  test("gates the pending deletion's retry the same way", async () => {
    const { account } = await openDangerZone("deletion-pending");
    const unconfirmed = dangerZoneView(account, {
      confirmed: false,
      attempt: undefined,
    });
    expect(unconfirmed.offer).toBe("pending");
    expect(unconfirmed.deleteAction).toBe("disabled");
    expect(
      dangerZoneView(account, { confirmed: true, attempt: undefined })
        .deleteAction
    ).toBe("enabled");
  });

  test("a refusal ends deleting for the visit", async () => {
    const { account } = await openDangerZone("linked");
    expect(
      dangerZoneView(account, {
        confirmed: true,
        attempt: { kind: "refused" },
      }).deleteAction
    ).toBe("disabled");
  });

  test("a retryable failure leaves deleting enabled", async () => {
    const { account } = await openDangerZone("linked");
    expect(
      dangerZoneView(account, {
        confirmed: true,
        attempt: { kind: "failed" },
      }).deleteAction
    ).toBe("enabled");
  });
});

describe("deletionSubmittable", () => {
  const choice = { confirmed: true, attempt: undefined };

  test("sends once the freshly read account offers deletion", async () => {
    const { account } = await openDangerZone("linked");
    expect(deletionSubmittable(AsyncResult.success(account), choice)).toBe(
      true
    );
  });

  test("waits while the account is refetched after the last attempt", async () => {
    const { account } = await openDangerZone("linked");
    expect(
      deletionSubmittable(
        AsyncResult.success(account, { waiting: true }),
        choice
      )
    ).toBe(false);
  });

  test("won't send once the refetched account withholds deletion", async () => {
    const { account } = await openDangerZone("linked", (workspace) =>
      workspace.setAccount(withDeletion(workspace.data.account, "withheld"))
    );
    expect(deletionSubmittable(AsyncResult.success(account), choice)).toBe(
      false
    );
  });

  test("won't send on an account it couldn't read", async () => {
    const { account } = await openDangerZone("linked");
    expect(
      deletionSubmittable(
        AsyncResult.fail("unavailable", {
          previousSuccess: Option.some(AsyncResult.success(account)),
        }),
        choice
      )
    ).toBe(false);
  });

  test("won't send without the customer's confirmation", async () => {
    const { account } = await openDangerZone("linked");
    expect(
      deletionSubmittable(AsyncResult.success(account), {
        confirmed: false,
        attempt: undefined,
      })
    ).toBe(false);
  });
});

describe("requestAccountDeletionAtom", () => {
  test("deleted: confirms the deletion and doesn't refetch the gone account", async () => {
    const { registry, workspace } = await openDangerZone("linked");

    const attempt = await deleteAccount(registry);

    expect(attempt).toEqual({ kind: "deleted" });
    expect(deletionFollowUp(attempt)).toEqual({
      shownIn: "dialog",
      next: "leave",
    });
    expect(workspace.calls).toEqual(["getAccount", "requestDeletion"]);
    expect(workspace.signedIn).toBe(false);
  });

  test("reauthentication-required: stays in the dialog, account refetched", async () => {
    const { registry, workspace } = await openDangerZone("linked", (fake) => {
      fake.deletionOutcome = "reauthentication-required";
    });

    const attempt = await deleteAccount(registry);

    expect(attempt).toEqual({ kind: "reauthentication-required" });
    expect(deletionFollowUp(attempt)).toEqual({
      shownIn: "dialog",
      next: "reauthenticate",
    });
    expect(workspace.signedIn).toBe(true);
    await accountAfter(registry);
    expect(workspace.calls).toEqual([
      "getAccount",
      "requestDeletion",
      "getAccount",
    ]);
  });

  test("refused: final, shown on the screen with nothing changed", async () => {
    const { registry, workspace } = await openDangerZone("linked", (fake) => {
      fake.deletionOutcome = "refused";
    });

    const attempt = await deleteAccount(registry);

    expect(attempt).toEqual({ kind: "refused" });
    expect(deletionFollowUp(attempt)).toEqual({
      shownIn: "screen",
      next: "none",
    });
    expect(deletionOffer(await accountAfter(registry))).toBe("offered");
    expect(workspace.signedIn).toBe(true);
  });

  test("failed: retryable from the dialog, and the retry can delete", async () => {
    const { registry, workspace } = await openDangerZone("linked", (fake) => {
      fake.deletionOutcome = "failed";
    });

    const attempt = await deleteAccount(registry);
    expect(attempt).toEqual({ kind: "failed" });
    expect(deletionFollowUp(attempt)).toEqual({
      shownIn: "dialog",
      next: "none",
    });
    await accountAfter(registry);

    workspace.deletionOutcome = "deleted";
    expect(await deleteAccount(registry)).toEqual({ kind: "deleted" });
  });

  test("unconfirmed: refetches and shows the deletion now pending", async () => {
    const { registry, workspace } = await openDangerZone("linked", (fake) => {
      fake.deletionOutcome = "failed";
      fake.fail("requestDeletion", "transport-failure");
    });
    // The server recorded the attempt as a pending deletion.
    workspace.setAccount(withDeletion(workspace.data.account, "pending"));

    const attempt = await deleteAccount(registry);

    expect(attempt).toEqual({ kind: "unconfirmed" });
    expect(deletionFollowUp(attempt)).toEqual({
      shownIn: "screen",
      next: "none",
    });
    expect(deletionOffer(await accountAfter(registry))).toBe("pending");
    expect(workspace.calls).toEqual([
      "getAccount",
      "requestDeletion",
      "getAccount",
    ]);
  });

  test("unconfirmed: refetches and shows deletion still offered", async () => {
    const { registry, workspace } = await openDangerZone("linked", (fake) => {
      fake.deletionOutcome = "failed";
      fake.fail("requestDeletion", "unreadable-answer");
    });

    const attempt = await deleteAccount(registry);

    expect(attempt).toEqual({ kind: "unconfirmed" });
    expect(deletionOffer(await accountAfter(registry))).toBe("offered");
    expect(workspace.calls).toEqual([
      "getAccount",
      "requestDeletion",
      "getAccount",
    ]);
  });

  test("a request that never reached the server fails retryably in the dialog", async () => {
    const { registry, workspace } = await openDangerZone("linked", (fake) => {
      fake.fail("requestDeletion", "service-unavailable");
    });

    const attempt = await deleteAccount(registry);

    expect(attempt).toMatchObject({
      kind: "request-failed",
      error: { _tag: "Unavailable" },
    });
    expect(deletionFollowUp(attempt)).toEqual({
      shownIn: "dialog",
      next: "none",
    });
    expect(workspace.calls).toEqual(["getAccount", "requestDeletion"]);
    expect(workspace.signedIn).toBe(true);
  });

  test("a rate-limited request says so", async () => {
    const { registry } = await openDangerZone("linked", (fake) => {
      fake.fail("requestDeletion", "rate-limited");
    });

    expect(await deleteAccount(registry)).toMatchObject({
      kind: "request-failed",
      error: { _tag: "RateLimited" },
    });
  });

  test("a pending deletion's retry goes through the same request", async () => {
    const { registry, workspace } = await openDangerZone("deletion-pending");

    expect(await deleteAccount(registry)).toEqual({ kind: "deleted" });
    expect(workspace.calls).toEqual(["getAccount", "requestDeletion"]);
  });
});
