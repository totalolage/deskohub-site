import "@/shared/polyfills/temporal";
import { describe, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Result, Schema } from "effect";
import type { SealedStateKeys } from "@/shared/backend/sealed-state-keys.service";
import {
  runSealedState,
  syntheticSealedStateKeyRing,
} from "@/shared/testing/sealed-state-keys.test-utils";

mock.module("server-only", () => ({}));

const {
  buildSignedPayState,
  getPayStateRestartKind,
  openPayState,
  sealPayStateForUrl,
  signedPayStateSchema,
} = await import("./pay-state");
const { buildCheckoutPayPath } = await import("./checkout-pay-url");
const { openAdvertisedPriceState, sealAdvertisedPriceState } = await import(
  "./advertised-price-state"
);

/*
 * Pay and advertised-price tokens live in open Pay pages and agent links, so
 * their bytes must not change. These tokens were sealed before the sealed
 * state codec was reworked; a change here breaks every token in flight.
 */

const goldenKey = syntheticSealedStateKeyRing(["golden", 9]);
const run = <A, E>(
  effect: Effect.Effect<A, E, SealedStateKeys>,
  options: { readonly at?: Date } = {}
) => runSealedState(effect, { keys: goldenKey, ...options });
const issuedAt = new Date("2026-06-01T10:00:00.000Z");
const beforeExpiry = () => new Date("2026-06-01T10:09:00.000Z");
const afterExpiry = () => new Date("2026-06-01T10:10:00.000Z");

const encodedPayState = {
  kid: "golden",
  iat: 1780308000,
  exp: 1780308600,
  locale: "en-US",
  orderId: "golden-order-id",
  bookedAt: "2026-06-01T09:58:00.000Z",
  checkoutSessionId: "golden-checkout-session-id",
  acceptedTotal: {
    value: 55000,
    exponent: 2,
    currency: "CZK",
  },
  reservation: {
    kind: "cowork",
    name: "Golden Fixture",
    email: testEmailAddress("golden"),
    phone: "+420 777 000 000",
    billing: {
      purpose: "personal",
      invoice: "none",
    },
    entryTier: "profi",
    coffee: true,
    monitorOption: "2x27-qhd",
    date: "2026-06-20",
  },
  quote: {
    items: [
      {
        type: "cowork",
        tier: "profi",
        amount: {
          value: 55000,
          exponent: 2,
          currency: "CZK",
        },
      },
      {
        type: "coffee",
        amount: {
          value: 0,
          exponent: 2,
          currency: "CZK",
        },
      },
    ],
    fingerprint: "9be3045c",
    payment: {
      expectedPrice: {
        value: 55000,
        exponent: 2,
        currency: "CZK",
      },
      undiscountedPrice: {
        value: 55000,
        exponent: 2,
        currency: "CZK",
      },
      discounts: [],
    },
  },
};

const encodedAdvertisedPriceState = {
  kid: "golden",
  iat: 1780308000,
  exp: 1780308600,
  locale: "en-US",
  kind: "cowork",
  reservation: {
    kind: "cowork",
    details: {
      kind: "cowork",
      entryTier: "basic",
      coffee: true,
      date: "2026-06-20",
    },
  },
  quote: {
    items: [
      {
        type: "cowork",
        tier: "basic",
        amount: {
          value: 35000,
          exponent: 2,
          currency: "CZK",
        },
      },
      {
        type: "coffee",
        amount: {
          value: 5000,
          exponent: 2,
          currency: "CZK",
        },
      },
    ],
    fingerprint: "dd5105b3",
    payment: {
      expectedPrice: {
        value: 40000,
        exponent: 2,
        currency: "CZK",
      },
      undiscountedPrice: {
        value: 40000,
        exponent: 2,
        currency: "CZK",
      },
      discounts: [],
    },
  },
};

/** Sealed with a random IV (all bytes 7). */
const payStateToken =
  "eyJraWQiOiJnb2xkZW4ifQ.BwcHBwcHBwcHBwcH.Ipnm9gxTxTsQhTvp86xRyh9RZz6iNsNypr4ioMtGsylvnaFNJD3bDNy1tGbk54CC89umLvi98zi8FgTBqR3WW8L1mJTbbpK6-sDDnlNg2kUs78hJYdS9gFHlBAxmuqiOZRSgFnWbNyZF0e2317lZy-37Dp_Bg6M7NuKJJbCjSJ1g9atc_3iOmaExsFe3oC2mWYcu93uJ_Qm2XZj8GnYimnm_PbMUc2dRu0XwJN7rzmKjeig9F4K7GMMYpQQnJJtdVp67U-uHG83g1czTc390kqSc4WcLaj11HWzzW378E9u3hhnA2HhdHKNJG8sbsD7j_rvyXltgyRjiMoMtvbjSwzKaPwCNL7uHI3hous67eQs159qL7DWXbwsYSBrukJWiqRzsgYBcxWf8uu1zB-ixt4Gbglrs4E-aSdUSu_AtQefRFVpbReH6tmTPeu71zvVoZJjjoSUfqsosP5YkmBe972AuX9NWX9T94CIas7KpoIvJAKtA9RU0a_B5ZkWT2Y8voCHaPKXQ5g1O9pDQRIB9ilE7Lo3or-xvvERdSGcIWzgSSfmcF-ermS2WLLS54G6gkmdgxRkG5Pk2WFREoUkS61EW3R1XgzjLXt4uQ0f6gaV06n8LeIRuwIYDmjhQJ0MMlvRBzqzx5nFGHkMnVI3ebVQz7PrYLnHSRTScBkZNCLz99W30y3yC2EPd9CyScntUo_IoSsyN8LaLndqJXzrDiIBG3twFys1oD9p3qW8_P7arDvNBfKvVG5ZZfRCt-I27SZMX5g-PJVp7CCO_Qihxgob_WEW-DNCojdQKgTkLcoTGkDS1otozsQdsN6NgsfRWSnPEZ8XnK1wIipkPpG0i1U4rm7SJ9oIwacvwZ-FGmNhpvUgJAadR32hWN3SXs3NyJUOAG1VEthKVw3hSIeMJZHVJrFY4co09FkGssf3OFFYSNbGFcWbj9R6wkiBMikhFRDj3uFHavxHLEcw6Jk54VzJY7ZzDqBxKdSREe8bSwOXMlGgSwGH6C_YZ1cCwtACKJJ7Oq47OMv1ezx6WhwOsFOtQ6LSSKGz4Fbtivz47km28StnJ9R1mFw4l4AwB09dv6kSWngmYjmilhAyi4ltVZiwja3VXrxCwYSUhYwr6.bIB6PcuU1x9vn3mS0YIk7g";
/** Sealed with a synthetic IV, as an agent's stable Pay link is. */
const stablePayStateToken =
  "eyJraWQiOiJnb2xkZW4ifQ.9wFM5EJy-pPMjP1p.KmemWS2NryGMx7iBK1TsjDwAjSLisxmCoT4FqLWdfFMhkCQjhsMobWmXK-ofRy9eqWMFKHhMSpqQ_pWs678_bfh0fljvNu-_pJskVAWLDNJ3YGe0vBM2BmADprSFBl3u0TxTZEAV2LF5785C2_458e6dVY8xeOR4NZuT7R6YzjtItCmvqMzgYQ8TK24I99otdZ0ItoJ9Nti6nlNuEyQGQ5tr-BM0gI6F8dtv5ylETsNmlwqvSqGCp6dOaMC4b0f713w4tvpN1OX46kSWuagrn1F84JO95Z3KUTCvnlLXRWBi7HduGAbBrjrnu29TXDvyx9lV2rWgIf8oD7aqn3BSsKzfcIF8woS_A3sNVPJPY2x-OnsnP28zKwHTHemcJj9wdPrqCHu3N7f4Zy2iqN6RaEIr1VuY26muhg7edXuEEcpS3MJF2XROJOFx5MniYJi-Q7ebwdHV7YKABYn5SWxSWBuQo_Ea8ZdGv0k2i9J4U5np4o57LB0STC8ZlGSZ9iO6YPv_NuAwPJUEXJcXG006K7tWWYe_6n0Su1bY5nnYJlxd5ihO0I8T33g4-do8PkO8w1_LlPoDVlUg42FVsPS_1acCMuzrHM-ycaM_tsHhMSVqSehS0eseILpDeDQEV5DPSPRvVkm59f9I32MrcAB61-cENWq23HMwwZ1gtS4j1CfbnUquJfmuheg6wt7REdGz-ZhijRr-I6jpwwhx5YJe7vVL-uInsexojmo96ALy93F7C1Q1ncSkxBWmvNCVmqZFTC9VinjpD4QFHM16HL71fsa81vt2ws7pMgTN26ihcLaX9FaQRryHRSlQnI8dfQnhhPA_jfjpRd8FjkN5OZlHSBH6lJQog1TONn8EbRHWYeQPT0begdIrxoUEbubeVeC3Nb1t7H1rbO1MKlhS3yk_c-MYugpp-FSwHcDx4eMR6TdK_8oyc4EoOPHF-hkHr-nF73Kr5JA3_EGBoffihG67PVLXkT2MA3CobX_i6e55wJ-x8ta2-grAQxRcR26gtJcmOfsSl_OZUUOJtrwV3KJRxLwsEyWfsPwOeQiVQVcB2b7F8gZgYLEYpWEoTSf4UhgMZy3kXaH4RMTIj9gqHXGGHqjJPKvBa1K8eM2qTNjv.as0UaQZnNQRm1ziVHUzGLQ";
/** Sealed with a random IV (all bytes 7). */
const advertisedPriceStateToken =
  "eyJraWQiOiJnb2xkZW4ifQ.BwcHBwcHBwcHBwcH.Ipnm9gxTxTsQhTvp86xRyh9RZz6iNsNypr4ioMtGsylvnaFNJD3bDNy1tGbk54CC89umLvi98zi8FgTBqR3WW8L1mJTfdZi7qrOF3wY10lgrqYEFPt68gUbhSBFr9-qOPQDtFnmREnBdyazqkOQdjf_hAcuVo_JrYKSTJfuxDcQ-odNE8TmChqsgsBru9hutXoY-zHyl6wm2XZ3yBXsk1nj-NrkRfm1B7VL3M9j9iy-pNjU8F5S7S5BJ9lljd9I7CcinQuWfEZr5wMWELCZszuXJvCQFcgN2T3fkTnWqC8PmxUzM32ENVe9eC4xTsEeb1_j8GxowgEnmLZo5p6Wfl2uCMkOKM7DBO3F_6ZH8Ols7vYbG7DGUfgsYWHGjn4S1tVnEi4EKijfawopzH_j8pc_NwQjurRncT9Q0ufA7CKSbAVUaROr94HyYeuj8ze5oZJj0uiEdtsh-cNFrxkLju3IkXd1YHsPm_isdvqypoNKoKpUQ-AcaIvAlLVuRzo4wvCnYaqvIrQdcrMiDFMB0ihN2MImzv6UjrQgTQTw5Si0FCLfbA8W2lifRIqyhrX6nm3cn3VdAoawqShUJqlgW6008wx0c1mTFRp9pSQeowrdlrGcFGbpElp4Ngm8McxhJ2KsCjeqkoFwYVVE3GcPAbRgpoubJaSaVVz73TUgbFLTouDmzxmfXjQOa9GPFdGBUv7NrSobd3IqpnYuHHDPFjo1diYgKm5kzOPJv9ig.jjqPmgfUDa6TJKsbsEvYvg";
/** Sealed with a synthetic IV. */
const stableAdvertisedPriceStateToken =
  "eyJraWQiOiJnb2xkZW4ifQ.ZALT_Mk40jHv3j4T.nczJV0qNv0nsWmxXecEAucUV40iRXjP02Ne4qb6UtaprJRhicQlJubz_W33f8r3D1wnNctf7lmuuQGpyk2gdg7cmA6CKO7VzN-QJVoDHn3MAc8jLGgMZGrVSzjfrnkBBzvVKNSEovt6fTZ1L1ENqSeNlR5mXEoctDLK0BeRQDZTQ-NjR9IHlj_4ImlkEtlJvnoxUCxX5C_vLOvDBO4XEmEkfIF1FqY7j-zMYR1xjmn5byyRSNZHHRMh6O-fIW59HE_lrsAbjFihPB7F1gWf8Nj1Ow1zkcOx-TVRfrzHDOgRriLYPc6Los3CzuZwXrlpsrbY7EjEqDB9Mcun915KJUMaC3ymouqNQtemnvc-GrYUcSdU7RdHRV5R4NB1UoaLrnrAHnbRFQbbKCApwHdIvEHUzeh6x5SNrjdnKnHxmb4kWiEegWzrgm9uHArfGMW_byTHPG4WewYfBqHxtUT__vpwu1gLzisNC-vTdjd78a-5tfQu4wFjllL-JOS17AHlH0lbCjgyaVF75k-5OYREEiui6Jir7Wwpbnh4JMFV_dOzO1OoryTo3QefMlkEDKNu6Be6s7tLNnBFh1mxj2wHtzgAiLwbVLLKsBMvVeJ1ULFHlUN5k7Xk74zsgw2SlobN_lGySrD2AlIHCELaSY9ZrsxD5LbrrAHQALOLAvzDrtvPPoUBQ438UkP1l-Lan15aOMkW4tk1yy3vAodux4CZrqG4jvnuGPkfBDAxo2BU.ws_KPNr0BusCXJMYSD6gxw";

const toJson = <A>(value: A): unknown => JSON.parse(JSON.stringify(value));

describe("Pay state token format", () => {
  test("issues and seals an agent's stable Pay link to the pinned URL", () => {
    const pinned =
      Schema.decodeUnknownSync(signedPayStateSchema)(encodedPayState);
    const state = run(
      buildSignedPayState(
        {
          locale: pinned.locale,
          reservation: pinned.reservation,
          quote: pinned.quote,
          orderId: pinned.orderId,
          bookedAt: pinned.bookedAt,
          checkoutSessionId: pinned.checkoutSessionId,
        } as Parameters<typeof buildSignedPayState>[0],
        { issuedAt: Temporal.Instant.from(issuedAt.toISOString()) }
      )
    );
    const sealed = run(sealPayStateForUrl(state, { deterministic: true }));

    expect(toJson(state)).toEqual(toJson(pinned));
    expect(sealed.token).toBe(stablePayStateToken);
    expect(
      buildCheckoutPayPath("en-US", sealed, { orderId: pinned.orderId })
    ).toBe(
      `/en-US/checkout/pay?payState=${stablePayStateToken}&orderId=golden-order-id`
    );
  });

  test("opens pinned tokens until they expire", () => {
    for (const token of [payStateToken, stablePayStateToken]) {
      const opened = run(openPayState(token), { at: beforeExpiry() });
      expect(Schema.encodeUnknownSync(signedPayStateSchema)(opened)).toEqual(
        encodedPayState
      );

      const expired = run(Effect.result(openPayState(token)), {
        at: afterExpiry(),
      });
      expect(Result.isFailure(expired) && expired.failure.code).toBe("expired");
    }
  });

  test("reads the reservation kind of an expired pinned token", () => {
    expect(
      run(getPayStateRestartKind(payStateToken), { at: afterExpiry() })
    ).toBe("cowork");
  });
});

describe("advertised price state token format", () => {
  test("opens pinned tokens and reseals them to the pinned bytes", () => {
    for (const token of [
      advertisedPriceStateToken,
      stableAdvertisedPriceStateToken,
    ]) {
      const opened = run(openAdvertisedPriceState(token), {
        at: beforeExpiry(),
      });
      expect(toJson(opened)).toEqual(encodedAdvertisedPriceState);
      expect(
        run(sealAdvertisedPriceState(opened, { deterministic: true }))
      ).toBe(stableAdvertisedPriceStateToken);
    }
  });

  test("rejects a pinned token once it expires", () => {
    const expired = run(
      Effect.result(openAdvertisedPriceState(advertisedPriceStateToken)),
      { at: afterExpiry() }
    );
    expect(Result.isFailure(expired) && expired.failure.code).toBe("expired");
  });
});
