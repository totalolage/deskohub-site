import { describe, expect, test } from "bun:test";
import {
  CustomerAccountLinkRequired,
  CustomerSessionRequired,
} from "@deskohub/workspace-customer-api";
import { Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";
import { HttpClientError, HttpClientRequest } from "effect/unstable/http";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";
import { AccountReadBudget, accountReadAllowance } from "./account-read-budget";
import { CustomerSessionCheck } from "./customer-api.service";
import {
  customerRead,
  customerWrite,
  refreshAfterWrite,
} from "./customer-request";
import { CustomerRequestDispatch } from "./customer-request-dispatch";

const harness = () => {
  const sessionChecks: string[] = [];
  const layer = Layer.mergeAll(
    AccountReadBudget.Default,
    Layer.succeed(CustomerSessionCheck, {
      recheck: Effect.sync(() => {
        sessionChecks.push("recheck");
      }),
    }),
    TestClock.layer()
  );
  const run = <A, E>(
    effect: Effect.Effect<A, E, AccountReadBudget | CustomerSessionCheck>
  ) =>
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(Effect.result(effect));
      yield* TestClock.adjust("1 minute");
      const result = yield* Fiber.join(fiber);
      const remaining = yield* (yield* AccountReadBudget).remaining;
      return { result, remaining };
    }).pipe(Effect.provide(layer), Effect.runPromise);
  return { run, sessionChecks };
};

/** What the client does when it sends the request: report the send. */
const sent = <A, E>(
  answer: Effect.Effect<A, E>
): Effect.Effect<A, E, CustomerRequestDispatch> =>
  Effect.flatMap(Effect.service(CustomerRequestDispatch), (dispatch) =>
    Effect.andThen(dispatch.onSend, answer)
  );

const transportFailure = new HttpClientError.HttpClientError({
  reason: new HttpClientError.TransportError({
    request: HttpClientRequest.post("https://workspace.deskohub.test/x"),
  }),
});

describe("customerRead", () => {
  test("spends the read budget for an account read", async () => {
    const { run } = harness();

    const { result, remaining } = await run(
      customerRead({ accountRead: true })(sent(Effect.succeed("history")))
    );

    expect(result).toMatchObject({ _tag: "Success", success: "history" });
    expect(remaining).toBe(accountReadAllowance.reads - 1);
  });

  test("leaves the budget alone for a Workspace-only read", async () => {
    const { run } = harness();

    const { remaining } = await run(
      customerRead({ accountRead: false })(sent(Effect.succeed("passkeys")))
    );

    expect(remaining).toBe(accountReadAllowance.reads);
  });

  test("gives up on a read with no answer in time", async () => {
    const { run } = harness();

    const { result } = await run(
      customerRead({ accountRead: false })(Effect.never)
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "CustomerRequestTimedOut" },
    });
  });

  test("asks the auth state to re-check the session on 401", async () => {
    const { run, sessionChecks } = harness();

    const { result } = await run(
      customerRead({ accountRead: false })(
        Effect.fail(new CustomerSessionRequired())
      )
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "CustomerSessionRequired" },
    });
    expect(sessionChecks).toEqual(["recheck"]);
  });
});

describe("customerRead attempts", () => {
  test("spends the budget once per send, so a retried read spends twice", async () => {
    const { run } = harness();

    const { remaining } = await run(
      customerRead({ accountRead: true })(
        Effect.andThen(sent(Effect.void), sent(Effect.succeed("history")))
      )
    );

    expect(remaining).toBe(accountReadAllowance.reads - 2);
  });
});

describe("customerWrite", () => {
  test("a write that never left the device times out as nothing applied", async () => {
    const { run } = harness();

    const { result } = await run(customerWrite(Effect.never));

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "CustomerRequestTimedOut" },
    });
  });

  test("keeps a failure from before sending, such as an invalid payload", async () => {
    const { run } = harness();
    const invalid = { _tag: "SchemaError" as const };

    const { result } = await run(customerWrite(Effect.fail(invalid)));

    expect(result).toMatchObject({ _tag: "Failure", failure: invalid });
  });

  test("reports a write with no answer in time as unconfirmed", async () => {
    const { run } = harness();

    const { result } = await run(customerWrite(sent(Effect.never)));

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "CustomerWriteUnconfirmed" },
    });
  });

  test("reports a broken connection as unconfirmed, keeping the cause", async () => {
    const { run } = harness();

    const { result } = await run(
      customerWrite(sent(Effect.fail(transportFailure)))
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "CustomerWriteUnconfirmed", cause: transportFailure },
    });
  });

  test("passes a refusal through: nothing was applied", async () => {
    const { run, sessionChecks } = harness();

    const { result } = await run(
      customerWrite(
        Effect.fail(
          new CustomerAccountLinkRequired({ reason: "profile-missing" })
        )
      )
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "CustomerAccountLinkRequired" },
    });
    expect(sessionChecks).toEqual([]);
  });
});

describe("refreshAfterWrite", () => {
  /** A registry whose `probe` counts its reads, and a write atom over it. */
  const setup = () => {
    let reads = 0;
    const probe = Atom.make(() => {
      reads += 1;
      return reads;
    });
    const write = Atom.fn(
      (outcome: Effect.Effect<string, unknown, CustomerRequestDispatch>, get) =>
        refreshAfterWrite(get, [probe])(customerWrite(outcome)).pipe(
          Effect.provideService(CustomerSessionCheck, { recheck: Effect.void })
        )
    );
    const registry = AtomRegistry.make();
    registry.mount(probe);
    registry.mount(write);
    const settleWrite = async (
      outcome: Effect.Effect<string, unknown, CustomerRequestDispatch>
    ) => {
      registry.set(write, outcome);
      await Effect.runPromise(
        Effect.result(
          AtomRegistry.getResult(write, { suspendOnWaiting: true })(registry)
        )
      );
      registry.get(probe);
      return reads - 1;
    };
    return { settleWrite };
  };

  test("refreshes after a write succeeds", async () => {
    expect(await setup().settleWrite(sent(Effect.succeed("saved")))).toBe(1);
  });

  test("refreshes after an unconfirmed write, to show what was saved", async () => {
    expect(await setup().settleWrite(sent(Effect.fail(transportFailure)))).toBe(
      1
    );
  });

  test("refreshes nothing after a refusal", async () => {
    expect(
      await setup().settleWrite(
        sent(
          Effect.fail(
            new CustomerAccountLinkRequired({ reason: "support-required" })
          )
        )
      )
    ).toBe(0);
  });
});
