import { Effect } from "effect";
import {
  createCheckoutStateClaims,
  sealCheckoutState,
} from "./checkout-state-token";

export const checkoutStatePrivacySentinels = {
  pii: "PII-SENTINEL-AUTHENTICATED-STATE",
  providerToken: "TOKEN-SENTINEL-AUTHENTICATED-STATE",
  providerUrl: "https://provider.example.test/URL-SENTINEL-AUTHENTICATED-STATE",
  checkoutSessionId: "SESSION-SENTINEL-AUTHENTICATED-STATE",
} as const;

export const makeAuthenticatedMalformedPayStateToken = () =>
  Effect.runSync(
    Effect.gen(function* () {
      const claims = yield* createCheckoutStateClaims(10 * 60 * 1000);
      const malformedState = {
        ...claims,
        locale: "en-US",
        orderId: "malformed-authenticated-state",
        checkoutSessionId: checkoutStatePrivacySentinels.checkoutSessionId,
        reservation: {
          kind: "unsupported-reservation-kind",
          name: checkoutStatePrivacySentinels.pii,
        },
        provider: {
          securityToken: checkoutStatePrivacySentinels.providerToken,
          redirectUrl: checkoutStatePrivacySentinels.providerUrl,
        },
      };

      return yield* sealCheckoutState(malformedState, {
        randomBytes: (size) => Buffer.alloc(size, 19),
      });
    })
  );
