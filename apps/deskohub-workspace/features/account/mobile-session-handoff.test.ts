import { describe, expect, test } from "bun:test";
import { createHash, randomBytes } from "node:crypto";
import { ConfigProvider, Effect, Schema } from "effect";
import {
  type CheckoutStateKey,
  checkoutStateKeyIdSchema,
} from "@/features/checkout/backend/checkout/checkout-state-token";
import {
  createMobileSessionHandoff,
  exchangeMobileSessionHandoff,
  getNeonSessionCookie,
  validateMobileAppScheme,
} from "./mobile-session-handoff";

const keys = [
  {
    kid: Schema.decodeUnknownSync(checkoutStateKeyIdSchema)("test"),
    key: randomBytes(32),
  },
] as const satisfies readonly CheckoutStateKey[];
const verifier = "a-test-verifier-that-remains-only-on-the-device";
const challenge = createHash("sha256").update(verifier).digest("base64url");
const sessionCookie = "__Secure-neon-auth.session_token=secret-session-value";

describe("mobile native session handoff", () => {
  test("accepts production and isolated preview schemes only", () => {
    expect(validateMobileAppScheme("deskohub-workspace")).toBe(true);
    expect(
      validateMobileAppScheme("deskohub-workspace-preview-p42-s1234abcd")
    ).toBe(true);
    expect(validateMobileAppScheme("https")).toBe(false);
    expect(validateMobileAppScheme("deskohub-workspace-preview")).toBe(false);
  });

  test("extracts only the primary Neon session cookie", () => {
    expect(
      getNeonSessionCookie(
        `other=1; ${sessionCookie}; __Secure-neon-auth.local.session_data=cached`
      )
    ).toBe(sessionCookie);
    expect(getNeonSessionCookie("other=1")).toBeNull();
  });

  test("seals the session and requires the matching PKCE verifier", async () => {
    const code = await Effect.runPromise(
      createMobileSessionHandoff({
        challenge,
        scheme: "deskohub-workspace",
        sessionCookie,
      }).pipe(provideKeyConfig)
    );
    expect(code).not.toContain("secret-session-value");
    await expect(
      Effect.runPromise(
        exchangeMobileSessionHandoff({ code, verifier }).pipe(provideKeyConfig)
      )
    ).resolves.toEqual({ sessionCookie });
    await expect(
      Effect.runPromise(
        exchangeMobileSessionHandoff({ code, verifier: "wrong" }).pipe(
          provideKeyConfig
        )
      )
    ).rejects.toThrow();
  });
});

const provideKeyConfig = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.provideService(
      ConfigProvider.ConfigProvider,
      ConfigProvider.fromUnknown({
        CHECKOUT_PAY_STATE_KEYS: `${keys[0].kid}:${keys[0].key.toString("base64url")}`,
      })
    )
  );
