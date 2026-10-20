import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Result, Schema } from "effect";
import {
  getAuthCallbackPath,
  readAuthCallbackReturnTo,
  signInCallbackReturnParam,
} from "@/features/account/routes";
import { invoiceBuyerSchema } from "@/features/accounting/billing-identity";
import {
  makeSealedState,
  parseSealedStateKey,
} from "@/shared/backend/sealed-state";
import { maxSameOriginPathLength } from "@/shared/utils/same-origin-path";
import {
  makeAuthReturnState,
  maxAuthReturnStateLength,
} from "./auth-return-state";

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
      maxTokenLength: maxAuthReturnStateLength,
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

      const token = runSync(
        contactBillingState.seal(contact, { keys, now: after(0) })
      );
      expect(token.length).toBeLessThanOrEqual(maxAuthReturnStateLength);
      expect(
        runSync(contactBillingState.open(token, { keys, now: after(0) }))
      ).toEqual(contact);

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
