import { describe, expect, test } from "bun:test";
import {
  CustomerAccountLinkRequired,
  CustomerSessionRequired,
} from "@deskohub/workspace-customer-api";
import { Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";
import { HttpClientError, HttpClientRequest } from "effect/unstable/http";
import { Atom } from "effect/unstable/reactivity";
import { CustomerSessionCheck } from "./customer-api.service";
import {
  customerRead,
  customerWrite,
  refreshAfterWrite,
} from "./customer-request";
import { DotyposReadBudget, dotyposReadAllowance } from "./dotypos-read-budget";

const harness = () => {
  const sessionChecks: string[] = [];
  const layer = Layer.mergeAll(
    DotyposReadBudget.Default,
    Layer.succeed(CustomerSessionCheck, {
      recheck: Effect.sync(() => {
        sessionChecks.push("recheck");
      }),
    }),
    TestClock.layer()
  );
  const run = <A, E>(
    effect: Effect.Effect<A, E, DotyposReadBudget | CustomerSessionCheck>
  ) =>
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(Effect.result(effect));
      yield* TestClock.adjust("1 minute");
      const result = yield* Fiber.join(fiber);
      const remaining = yield* (yield* DotyposReadBudget).remaining;
      return { result, remaining };
    }).pipe(Effect.provide(layer), Effect.runPromise);
  return { run, sessionChecks };
};

const transportFailure = new HttpClientError.HttpClientError({
  reason: new HttpClientError.TransportError({
    request: HttpClientRequest.post("https://workspace.deskohub.test/x"),
  }),
});

describe("customerRead", () => {
  test("spends the read budget for a Dotypos-backed read", async () => {
    const { run } = harness();

    const { result, remaining } = await run(
      customerRead({ dotyposBacked: true })(Effect.succeed("history"))
    );

    expect(result).toMatchObject({ _tag: "Success", success: "history" });
    expect(remaining).toBe(dotyposReadAllowance.reads - 1);
  });

  test("leaves the budget alone for a Workspace-only read", async () => {
    const { run } = harness();

    const { remaining } = await run(
      customerRead({ dotyposBacked: false })(Effect.succeed("passkeys"))
    );

    expect(remaining).toBe(dotyposReadAllowance.reads);
  });

  test("gives up on a read with no answer in time", async () => {
    const { run } = harness();

    const { result } = await run(
      customerRead({ dotyposBacked: false })(Effect.never)
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "CustomerRequestTimedOut" },
    });
  });

  test("asks the auth state to re-check the session on 401", async () => {
    const { run, sessionChecks } = harness();

    const { result } = await run(
      customerRead({ dotyposBacked: false })(
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

describe("customerWrite", () => {
  test("reports a write with no answer in time as unconfirmed", async () => {
    const { run } = harness();

    const { result } = await run(customerWrite(Effect.never));

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "CustomerWriteUnconfirmed" },
    });
  });

  test("reports a broken connection as unconfirmed, keeping the cause", async () => {
    const { run } = harness();

    const { result } = await run(customerWrite(Effect.fail(transportFailure)));

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
  const account = Atom.make(0);
  const recording = () => {
    const refreshed: unknown[] = [];
    return {
      refreshed,
      get: { refresh: (atom: Atom.Atom<unknown>) => refreshed.push(atom) },
    };
  };

  test("refreshes after a write succeeds", async () => {
    const { refreshed, get } = recording();

    await Effect.runPromise(
      Effect.result(refreshAfterWrite(get, [account])(Effect.succeed("saved")))
    );

    expect(refreshed).toEqual([account]);
  });

  test("refreshes after an unconfirmed write, to show what was saved", async () => {
    const { refreshed, get } = recording();

    await Effect.runPromise(
      Effect.result(
        refreshAfterWrite(get, [account])(
          customerWrite(Effect.fail(transportFailure))
        )
      ).pipe(
        Effect.provideService(CustomerSessionCheck, { recheck: Effect.void })
      )
    );

    expect(refreshed).toEqual([account]);
  });

  test("refreshes nothing after a refusal", async () => {
    const { refreshed, get } = recording();

    await Effect.runPromise(
      Effect.result(
        refreshAfterWrite(get, [account])(
          Effect.fail(
            new CustomerAccountLinkRequired({ reason: "support-required" })
          )
        )
      )
    );

    expect(refreshed).toEqual([]);
  });
});
