import { describe, expect, test } from "bun:test";
import type { ReferralCode } from "@deskohub/workspace-customer-api";
import { Effect, Layer, Option } from "effect";
import { TestClock } from "effect/testing";
import {
  applyRememberedReferralUpdate,
  RememberedReferralUpdate,
  rememberedReferralUpdate,
} from "./remembered-referral";
import {
  RememberedReferralCode,
  RememberedReferralStorage,
  RememberedReferralStorageUnavailable,
  rememberedReferralKey,
} from "./remembered-referral.service";
import { inMemoryRememberedReferralStorage } from "./remembered-referral.service.mock";

const code = "FRIEND-42" as ReferralCode;
const otherCode = "FRIEND-77" as ReferralCode;
const scope = {
  apiOrigin: "https://workspace.example.test",
  accountId: "account-1",
};
const day = 24 * 60 * 60 * 1000;

const run = <A>(
  entries: Map<string, string>,
  program: Effect.Effect<A, never, RememberedReferralCode | TestClock.TestClock>
) =>
  Effect.runPromise(
    program.pipe(
      Effect.provide(
        Layer.mergeAll(
          RememberedReferralCode.Default.pipe(
            Layer.provide(inMemoryRememberedReferralStorage(entries))
          ),
          TestClock.layer()
        )
      )
    )
  );

const referrals = Effect.service(RememberedReferralCode);

describe("rememberedReferralUpdate", () => {
  test("remembers an accepted code", () => {
    expect(rememberedReferralUpdate({ rememberReferralCode: code })).toEqual(
      Option.some(RememberedReferralUpdate.Remember({ code }))
    );
  });

  test("forgets a used-up code", () => {
    expect(
      rememberedReferralUpdate({ rememberedReferralCodeUsed: true })
    ).toEqual(Option.some(RememberedReferralUpdate.Forget()));
  });

  test("a newly accepted code wins over the used-up one it replaces", () => {
    expect(
      rememberedReferralUpdate({
        rememberReferralCode: code,
        rememberedReferralCodeUsed: true,
      })
    ).toEqual(Option.some(RememberedReferralUpdate.Remember({ code })));
  });

  test("a response without referral news changes nothing", () => {
    expect(rememberedReferralUpdate({})).toEqual(Option.none());
  });

  test("the code to send follows the update", () => {
    expect(
      applyRememberedReferralUpdate(RememberedReferralUpdate.Remember({ code }))
    ).toEqual(Option.some(code));
    expect(
      applyRememberedReferralUpdate(RememberedReferralUpdate.Forget())
    ).toEqual(Option.none());
  });
});

describe("RememberedReferralCode", () => {
  test("keys the code by Workspace origin and account", () => {
    expect(rememberedReferralKey(scope)).toBe(
      "deskohub.booking.referral.v1.https://workspace.example.test.account-1"
    );
  });

  test("remembers a code for the referral cookie's 30 days", async () => {
    const entries = new Map<string, string>();
    const found = await run(
      entries,
      Effect.gen(function* () {
        const remembered = yield* referrals;
        yield* remembered.remember(scope, code);
        const fresh = yield* remembered.get(scope);
        yield* TestClock.adjust(30 * day - 1);
        const lastMoment = yield* remembered.get(scope);
        yield* TestClock.adjust(1);
        const expired = yield* remembered.get(scope);
        return { fresh, lastMoment, expired };
      })
    );
    expect(found).toEqual({
      fresh: Option.some(code),
      lastMoment: Option.some(code),
      expired: Option.none(),
    });
    expect(entries.size).toBe(0);
  });

  test("keeps one code per account and origin", async () => {
    const entries = new Map<string, string>();
    const otherAccount = { ...scope, accountId: "account-2" };
    const otherOrigin = { ...scope, apiOrigin: "https://preview.example.test" };
    const found = await run(
      entries,
      Effect.gen(function* () {
        const remembered = yield* referrals;
        yield* remembered.remember(scope, code);
        yield* remembered.remember(otherAccount, otherCode);
        return [
          yield* remembered.get(scope),
          yield* remembered.get(otherAccount),
          yield* remembered.get(otherOrigin),
        ];
      })
    );
    expect(found).toEqual([
      Option.some(code),
      Option.some(otherCode),
      Option.none(),
    ]);
  });

  test("applies a response's updates: replace, then forget", async () => {
    const entries = new Map<string, string>();
    const found = await run(
      entries,
      Effect.gen(function* () {
        const remembered = yield* referrals;
        yield* remembered.apply(
          scope,
          RememberedReferralUpdate.Remember({ code })
        );
        yield* remembered.apply(
          scope,
          RememberedReferralUpdate.Remember({ code: otherCode })
        );
        const replaced = yield* remembered.get(scope);
        yield* remembered.apply(scope, RememberedReferralUpdate.Forget());
        return { replaced, forgotten: yield* remembered.get(scope) };
      })
    );
    expect(found).toEqual({
      replaced: Option.some(otherCode),
      forgotten: Option.none(),
    });
  });

  test("drops an unreadable entry", async () => {
    const entries = new Map([[rememberedReferralKey(scope), "{not json"]]);
    const found = await run(
      entries,
      Effect.flatMap(referrals, (remembered) => remembered.get(scope))
    );
    expect(found).toEqual(Option.none());
    expect(entries.has(rememberedReferralKey(scope))).toBe(false);
  });

  test("storage failures never fail the booking", async () => {
    const unavailable = Effect.fail(
      new RememberedReferralStorageUnavailable({ cause: "disk" })
    );
    const failingStorage = Layer.succeed(RememberedReferralStorage, {
      getItem: () => unavailable,
      setItem: () => unavailable,
      removeItem: () => unavailable,
    });
    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const remembered = yield* referrals;
        yield* remembered.remember(scope, code);
        yield* remembered.forget(scope);
        return yield* remembered.get(scope);
      }).pipe(
        Effect.provide(
          RememberedReferralCode.Default.pipe(Layer.provide(failingStorage))
        )
      )
    );
    expect(found).toEqual(Option.none());
  });
});
