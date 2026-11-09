import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  type AsyncResult,
  type Atom,
  AtomRegistry,
} from "effect/unstable/reactivity";
import { AccountReadBudget, accountReadAllowance } from "./account-read-budget";
import { CustomerApi, CustomerAuthApi } from "./customer-api.service";
import { accountAtom, customerDataRuntime } from "./customer-data-runtime";
import { customerWrite, refreshAfterWrite } from "./customer-request";
import {
  makeFakeCustomerData,
  settle,
} from "./testing/customer-data-test-registry";
import { sampleEmail } from "./testing/sample-fixtures";

const renameProfile = customerDataRuntime.fn((firstName: string, get) =>
  Effect.flatMap(Effect.service(CustomerApi), (api) =>
    api.account.updateProfile({ payload: { firstName } })
  ).pipe(customerWrite, refreshAfterWrite(get, [accountAtom]))
);

const deletePasskey = customerDataRuntime.fn((id: string) =>
  Effect.flatMap(Effect.service(CustomerAuthApi), (auth) =>
    auth.auth.deletePasskey({ payload: { id } })
  ).pipe(customerWrite)
);

const run = <A, E>(
  registry: AtomRegistry.AtomRegistry,
  atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>
) =>
  Effect.runPromise(
    Effect.result(
      AtomRegistry.getResult(atom, { suspendOnWaiting: true })(registry)
    )
  );

const remainingReadsAtom = customerDataRuntime.atom(
  Effect.flatMap(
    Effect.service(AccountReadBudget),
    (budget) => budget.remaining
  )
);

describe("accountAtom", () => {
  test("reads the signed-in account through the real client", async () => {
    const { registry, workspace } = makeFakeCustomerData("linked");

    const result = await settle(registry, accountAtom);

    expect(result).toMatchObject({
      _tag: "Success",
      success: { kind: "linked", email: sampleEmail },
    });
    expect(workspace.calls).toEqual(["getAccount"]);
  });

  test("counts the read against the account's own budget only", async () => {
    const first = makeFakeCustomerData("linked");
    const second = makeFakeCustomerData("linked");

    await settle(first.registry, accountAtom);

    expect(await settle(first.registry, remainingReadsAtom)).toMatchObject({
      success: accountReadAllowance.reads - 1,
    });
    expect(await settle(second.registry, remainingReadsAtom)).toMatchObject({
      success: accountReadAllowance.reads,
    });
  });

  test("re-checks the session when the API answers 401", async () => {
    const { registry, workspace, device } = makeFakeCustomerData("linked");
    workspace.signedIn = false;

    const result = await settle(registry, accountAtom);

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "CustomerSessionRequired" },
    });
    expect(device.sessionChecks).toBe(1);
  });

  test("retries a read once after the connection breaks", async () => {
    const { registry, workspace } = makeFakeCustomerData("linked");
    workspace.fail("getAccount", "transport-failure");

    const result = await settle(registry, accountAtom);

    expect(result._tag).toBe("Success");
    expect(workspace.calls).toEqual(["getAccount", "getAccount"]);
  });

  test("surfaces a 429 without retrying", async () => {
    const { registry, workspace } = makeFakeCustomerData("linked");
    workspace.fail("getAccount", "rate-limited");

    const result = await settle(registry, accountAtom);

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "CustomerRateLimited" },
    });
    expect(workspace.calls).toEqual(["getAccount"]);
  });

  test("spends the budget for each attempt the server saw", async () => {
    const { registry, workspace } = makeFakeCustomerData("linked");
    workspace.fail("getAccount", "transport-failure");

    await settle(registry, accountAtom);

    expect(await settle(registry, remainingReadsAtom)).toMatchObject({
      success: accountReadAllowance.reads - 2,
    });
  });
});

describe("mutations", () => {
  test("an applied write with an unreadable answer is unconfirmed and shows the saved state", async () => {
    const { registry, workspace } = makeFakeCustomerData("linked");
    const unmount = registry.mount(accountAtom);
    await run(registry, accountAtom);
    workspace.fail("updateProfile", "unreadable-answer");

    registry.mount(renameProfile);
    registry.set(renameProfile, "Robin");
    const write = await run(registry, renameProfile);
    const account = await run(registry, accountAtom);
    unmount();

    expect(write).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "CustomerWriteUnconfirmed" },
    });
    expect(workspace.calls).toEqual([
      "getAccount",
      "updateProfile",
      "getAccount",
    ]);
    expect(account).toMatchObject({
      success: { kind: "linked", profile: { firstName: "Robin" } },
    });
  });

  test("re-checks the session when Better Auth answers 401", async () => {
    const { registry, workspace, device } = makeFakeCustomerData("linked");
    workspace.signedIn = false;

    registry.mount(deletePasskey);
    registry.set(deletePasskey, "sample-passkey-1");
    const result = await run(registry, deletePasskey);

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "CustomerAuthRejected", reason: "unauthorized" },
    });
    expect(device.sessionChecks).toBe(1);
  });

  test("a deleted passkey leaves the account's own list", async () => {
    const { registry } = makeFakeCustomerData("linked");

    registry.mount(deletePasskey);
    registry.set(deletePasskey, "sample-passkey-1");
    await run(registry, deletePasskey);
    const account = await settle(registry, accountAtom);

    expect(account).toMatchObject({
      success: { passkeys: { passkeys: [{ id: "sample-passkey-2" }] } },
    });
  });
});
