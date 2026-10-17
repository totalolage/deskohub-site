import { describe, expect, test } from "bun:test";
import { Effect, Result, Schema } from "effect";
import {
  makeSealedState,
  parseSealedStateKey,
} from "@/shared/backend/sealed-state";
import { makeAuthReturnState } from "./auth-return-state";

const runSync = <A, E>(effect: Effect.Effect<A, E>) => Effect.runSync(effect);
const keys = [
  runSync(
    parseSealedStateKey("active", Buffer.alloc(32, 4).toString("base64url"))
  ),
];
const now = new Date("2026-10-17T10:00:00.000Z");
const after = (minutes: number) => () =>
  new Date(now.getTime() + minutes * 60 * 1000);
const contactSchema = Schema.Struct({ name: Schema.String });
const contactState = makeAuthReturnState("checkout-contact", contactSchema);

describe("auth return state", () => {
  test("stays usable for 30 minutes after it is sealed", () => {
    const token = runSync(
      contactState.seal({ name: "Ada" }, { keys, now: after(0) })
    );

    expect(runSync(contactState.open(token, { keys, now: after(29) }))).toEqual(
      { name: "Ada" }
    );
    expect(
      Result.isFailure(
        runSync(
          Effect.result(contactState.open(token, { keys, now: after(30) }))
        )
      )
    ).toBe(true);
  });

  test("opens only tokens sealed for an auth return of the same purpose", () => {
    const otherReturn = makeAuthReturnState("other", contactSchema);
    const plain = makeSealedState({
      purpose: "checkout-contact",
      schema: contactSchema,
      ttlMilliseconds: 60_000,
    });
    const foreignTokens = [
      runSync(otherReturn.seal({ name: "Ada" }, { keys, now: after(0) })),
      runSync(plain.seal({ name: "Ada" }, { keys, now: after(0) })),
    ];

    for (const token of foreignTokens) {
      expect(
        Result.isFailure(
          runSync(
            Effect.result(contactState.open(token, { keys, now: after(0) }))
          )
        )
      ).toBe(true);
    }
  });
});
