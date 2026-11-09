import { describe, expect, test } from "bun:test";
import { Effect, type Layer, Redacted, Result } from "effect";
import { syntheticSealedStateKeyRing } from "@/shared/testing/sealed-state-keys.test-utils";
import { SealedStateKeys } from "./sealed-state-keys.service";

const readKeys = (layer: Layer.Layer<SealedStateKeys, unknown>) =>
  Effect.runPromise(
    Effect.result(
      Effect.gen(function* () {
        return yield* SealedStateKeys;
      }).pipe(Effect.provide(layer))
    )
  );

describe("SealedStateKeys", () => {
  test("keeps the configured order, the first key active", async () => {
    const configured = syntheticSealedStateKeyRing(
      ["rotated", 2],
      ["original", 1]
    );
    const keys = await readKeys(SealedStateKeys.fromConfiguration(configured));

    expect(Result.isSuccess(keys)).toBe(true);
    if (Result.isFailure(keys)) return;
    expect(keys.success.ring.map(({ kid }) => kid)).toEqual([
      "rotated",
      "original",
    ]);
    expect(keys.success.ring[0].key).toEqual(Buffer.alloc(32, 2));
    expect(Redacted.value(keys.success.configured)).toBe(configured);
  });

  test("keeps the configured string exactly as written", async () => {
    // Key IDs are trimmed when parsed, but the legacy lookup digest is keyed
    // by the whole string, spaces included.
    const configured = ` spaced :${Buffer.alloc(32, 1).toString("base64url")}`;
    const keys = await readKeys(SealedStateKeys.fromConfiguration(configured));

    expect(Result.isSuccess(keys) && keys.success.ring[0].kid).toBe("spaced");
    expect(
      Result.isSuccess(keys) && Redacted.value(keys.success.configured)
    ).toBe(configured);
  });

  test.each([
    ["an empty ring", ""],
    ["an entry without a key", "kid"],
    ["an entry with extra parts", `kid:${"a".repeat(43)}:extra`],
    ["a key ID of spaces", `  :${Buffer.alloc(32, 1).toString("base64url")}`],
    ["a short key", `kid:${Buffer.alloc(16, 1).toString("base64url")}`],
  ])("rejects %s as an invalid secret", async (_label, configured) => {
    const keys = await readKeys(SealedStateKeys.fromConfiguration(configured));

    expect(Result.isFailure(keys) && keys.failure).toMatchObject({
      _tag: "SealedStateTokenError",
      code: "invalid-secret",
    });
  });

  test("reads the configured key ring by default", async () => {
    const keys = await readKeys(SealedStateKeys.Default);

    expect(
      Result.isSuccess(keys) && Redacted.value(keys.success.configured)
    ).toBe(process.env.CHECKOUT_PAY_STATE_KEYS);
  });
});
