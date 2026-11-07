import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { accountAtom, customerDataRuntime } from "./customer-data-runtime";
import { DotyposReadBudget, dotyposReadAllowance } from "./dotypos-read-budget";
import {
  makeFakeCustomerData,
  settle,
} from "./testing/customer-data-test-registry";
import { sampleEmail } from "./testing/sample-fixtures";

const remainingReadsAtom = customerDataRuntime.atom(
  Effect.flatMap(
    Effect.service(DotyposReadBudget),
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
      success: dotyposReadAllowance.reads - 1,
    });
    expect(await settle(second.registry, remainingReadsAtom)).toMatchObject({
      success: dotyposReadAllowance.reads,
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
});
