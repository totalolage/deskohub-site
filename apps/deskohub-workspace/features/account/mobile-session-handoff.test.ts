import { describe, expect, test } from "bun:test";
import { createHash, randomBytes } from "node:crypto";
import { ConfigProvider, Effect, Schema } from "effect";
import {
  type CheckoutStateKey,
  checkoutStateKeyIdSchema,
} from "@/features/checkout/backend/checkout/checkout-state-token";
import { MobileSessionHandoffRepositoryMock } from "./backend/mobile-session-handoff.repository.mock";
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
    const availableCodes = new Set<string>();
    const repositoryLayer = MobileSessionHandoffRepositoryMock({
      reserve: (input) =>
        Effect.sync(() => {
          availableCodes.add(input.codeHash);
        }),
      consume: (input) =>
        Effect.sync(() => {
          if (!availableCodes.has(input.codeHash)) return false;
          availableCodes.delete(input.codeHash);
          return true;
        }),
    });
    const provideTestServices = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(
        Effect.provide(repositoryLayer),
        Effect.provideService(
          ConfigProvider.ConfigProvider,
          ConfigProvider.fromUnknown({
            CHECKOUT_PAY_STATE_KEYS: `${keys[0].kid}:${keys[0].key.toString("base64url")}`,
          })
        )
      );
    const code = await Effect.runPromise(
      createMobileSessionHandoff({
        challenge,
        scheme: "deskohub-workspace",
        sessionCookie,
      }).pipe(provideTestServices)
    );
    expect(code).not.toContain("secret-session-value");
    expect([...availableCodes]).toEqual([
      createHash("sha256").update(code).digest("base64url"),
    ]);
    await expect(
      Effect.runPromise(
        exchangeMobileSessionHandoff({ code, verifier: "wrong" }).pipe(
          provideTestServices
        )
      )
    ).rejects.toThrow();
    expect(availableCodes.size).toBe(1);
    const exchanges = await Promise.allSettled([
      Effect.runPromise(
        exchangeMobileSessionHandoff({ code, verifier }).pipe(
          provideTestServices
        )
      ),
      Effect.runPromise(
        exchangeMobileSessionHandoff({ code, verifier }).pipe(
          provideTestServices
        )
      ),
    ]);
    expect(exchanges.filter(({ status }) => status === "fulfilled")).toEqual([
      { status: "fulfilled", value: { sessionCookie } },
    ]);
    expect(
      exchanges.filter(({ status }) => status === "rejected")
    ).toHaveLength(1);
    expect(availableCodes.size).toBe(0);
  });
});
