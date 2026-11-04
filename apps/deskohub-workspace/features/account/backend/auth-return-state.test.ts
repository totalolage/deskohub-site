import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Result, Schema } from "effect";
import {
  getAuthCallbackPath,
  readAuthCallbackReturnTo,
  signInCallbackReturnParam,
} from "@/features/account/routes";
import { invoiceBuyerSchema } from "@/features/accounting/billing-identity";
import { makeSealedState } from "@/shared/backend/sealed-state";
import type { SealedStateKeys } from "@/shared/backend/sealed-state-keys.service";
import {
  runSealedState,
  syntheticSealedStateKeyRing,
} from "@/shared/testing/sealed-state-keys.test-utils";
import { maxSameOriginPathLength } from "@/shared/utils/same-origin-path";
import {
  makeAuthReturnState,
  maxAuthReturnStateLength,
} from "./auth-return-state";

const keys = syntheticSealedStateKeyRing(["active", 4]);
const now = new Date("2026-10-17T10:00:00.000Z");
const after = (minutes: number) =>
  new Date(now.getTime() + minutes * 60 * 1000);
/** Runs auth return state work under `ringKeys`, at `at`. */
const runAt = <A, E>(
  at: Date,
  effect: Effect.Effect<A, E, SealedStateKeys>,
  ringKeys = keys
) => runSealedState(effect, { keys: ringKeys, at });
const contactSchema = Schema.Struct({ name: Schema.String });
const contactState = makeAuthReturnState("checkout-contact", contactSchema);

describe("auth return state", () => {
  test("stays usable for 30 minutes after it is sealed", () => {
    const token = runAt(after(0), contactState.seal({ name: "Ada" }));

    expect(runAt(after(29), contactState.open(token))).toEqual({ name: "Ada" });
    expect(
      Result.isFailure(
        runAt(after(30), Effect.result(contactState.open(token)))
      )
    ).toBe(true);
  });

  test("opens only tokens sealed for an auth return of the same purpose", () => {
    const otherReturn = makeAuthReturnState("other", contactSchema);
    const plain = makeSealedState({
      purpose: "checkout-contact",
      schema: contactSchema,
      ttlMilliseconds: 60_000,
      maxTokenLength: maxAuthReturnStateLength,
    });
    const foreignTokens = [
      runAt(after(0), otherReturn.seal({ name: "Ada" })),
      runAt(after(0), plain.seal({ name: "Ada" })),
    ];

    for (const token of foreignTokens) {
      expect(
        Result.isFailure(
          runAt(after(0), Effect.result(contactState.open(token)))
        )
      ).toBe(true);
    }
  });

  // Text that inflates the most once serialized or barely compresses: escaped
  // control characters and lone surrogates, and scattered characters of
  // multi-byte scripts.
  const characterRanges = {
    "control characters": [0x01, 0x1f],
    "lone surrogates": [0xd800, 0xdfff],
    "three-byte characters": [0x800, 0xd7ff],
    "any code unit": [0x00, 0xffff],
  } as const;
  const scatteredText = (
    [low, high]: readonly [number, number],
    length: number,
    seed: number
  ) => {
    let state = seed;
    const characters = Array.from({ length: length - 2 }, () => {
      state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
      return String.fromCharCode(
        low + Math.floor((state / 2_147_483_648) * (high - low + 1))
      );
    });
    // Billing text is trimmed, so it starts and ends with a letter.
    return `x${characters.join("").replace(/\s/g, "y")}x`;
  };
  // The checkout contact step seals the contact with the billing details.
  const contactBillingState = makeAuthReturnState(
    "checkout-contact",
    Schema.Struct({
      name: Schema.String,
      email: Schema.String,
      phone: Schema.String,
      billing: invoiceBuyerSchema,
    })
  );

  test.each(Object.entries(characterRanges))(
    "carries the largest contact and billing details in %s through a magic link",
    (_name, range) => {
      const text = (length: number, seed: number) =>
        scatteredText(range, length, seed);
      const billing = Schema.decodeUnknownSync(invoiceBuyerSchema)({
        kind: "business",
        legalName: text(180, 1),
        companyId: text(255, 2),
        vatId: text(255, 3),
        address: {
          line1: text(180, 4),
          line2: text(180, 5),
          city: text(255, 6),
          postalCode: "110 00",
          country: "CZ",
        },
      });

      // The contact step accepts names up to 100 characters, emails up to
      // 255, and phones up to 20.
      const contact = {
        name: text(100, 7),
        email: testEmailAddress(text(241, 8)),
        phone: "+420 777 060 478 123",
        billing,
      };

      const token = runAt(after(0), contactBillingState.seal(contact));
      expect(token.length).toBeLessThanOrEqual(maxAuthReturnStateLength);
      expect(runAt(after(0), contactBillingState.open(token))).toEqual(contact);

      // The page and its other parameters take the rest of the return path.
      const page = "/cs-CZ/cowork?selection=";
      const returnTo = `${page}${"s".repeat(
        maxSameOriginPathLength - maxAuthReturnStateLength - page.length - 9
      )}&contact=${token}`;
      expect(returnTo.length).toBeLessThanOrEqual(maxSameOriginPathLength);
      const callbackPath = getAuthCallbackPath("cs-CZ", {
        attemptId: crypto.randomUUID(),
        returnTo,
      });
      const callback = new URL(callbackPath, "https://workspace.test");
      expect(
        readAuthCallbackReturnTo(
          callback.searchParams.get(signInCallbackReturnParam)
        )
      ).toBe(returnTo);

      // Better Auth's magic link, on a long preview host, fits Vercel's 14 KB.
      const magicLink = new URL(
        `https://deskohub-workspace-git-${"b".repeat(40)}-deskohub.vercel.app/api/auth/magic-link/verify`
      );
      magicLink.searchParams.set("token", "t".repeat(32));
      magicLink.searchParams.set("callbackURL", callbackPath);
      expect(magicLink.toString().length).toBeLessThan(14 * 1024);
    }
  );
});

describe("auth return state token format", () => {
  // Sealed before the sealed state codec was reworked; tokens in flight on
  // sign-in return paths must keep opening.
  const goldenKeys = syntheticSealedStateKeyRing(["golden", 9]);
  const issuedAt = new Date("2026-06-01T10:00:00.000Z");
  const beforeExpiry = new Date("2026-06-01T10:29:00.000Z");
  const goldenState = makeAuthReturnState("golden-contact", contactSchema);
  /** Sealed with a random IV (all bytes 7). */
  const goldenToken =
    "eyJraWQiOiJnb2xkZW4iLCJwdXJwb3NlIjoiYXV0aC1yZXR1cm46Z29sZGVuLWNvbnRhY3QiLCJ6aXAiOiJERUYifQ.BwcHBwcHBwcHBwcH.8u1HUSQgTUs9JZjE3w8gNGzySmbRvsBxKb4hpkNGsymT7o6YfJ_oZbENgJ_GrPzhVlsu12XM4QdMmKo_DSnu0qP8_vw_TmO144g.m91uBX7Vagghx_s2jE-EHQ";
  /** Sealed with a synthetic IV. */
  const stableGoldenToken =
    "eyJraWQiOiJnb2xkZW4iLCJwdXJwb3NlIjoiYXV0aC1yZXR1cm46Z29sZGVuLWNvbnRhY3QiLCJ6aXAiOiJERUYifQ.qSULXz5f46eJZDn1.CyOAuTszJr9Qv0b5FBfhyatUJlbyWkNMcXL11IuqMjZMXR2vzOOADam3vE72mPkOcOI0o4zN-Yz7TnUlGgckLArtPtGYZ4EuSt4.-Gmh24i2EyynF94M0EdhVA";

  test("seals deterministically to the pinned bytes", () => {
    expect(
      runAt(
        issuedAt,
        goldenState.seal({ name: "Golden Fixture" }, { deterministic: true }),
        goldenKeys
      )
    ).toBe(stableGoldenToken);
  });

  test("opens pinned tokens until they expire", () => {
    for (const token of [goldenToken, stableGoldenToken]) {
      expect(runAt(beforeExpiry, goldenState.open(token), goldenKeys)).toEqual({
        name: "Golden Fixture",
      });
      expect(
        Result.isFailure(
          runSealedState(Effect.result(goldenState.open(token)), {
            keys: goldenKeys,
          })
        )
      ).toBe(true);
    }
  });
});
