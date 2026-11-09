import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

const accountId = "account-1";
const otherAccountId = "account-2";
const tenMinutes = 10 * 60 * 1000;

type PublicKeyCredentialStub = {
  getClientCapabilities?: () => Promise<Record<string, boolean>>;
  isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean>;
};

let passkeyPrompt: typeof import("./passkey-prompt");
let originalDateNow: typeof Date.now;
let currentTime: number;

const installPublicKeyCredential = (
  stub: PublicKeyCredentialStub | undefined
) => {
  Object.defineProperty(globalThis, "PublicKeyCredential", {
    configurable: true,
    value: stub,
  });
};

const capableBrowser: PublicKeyCredentialStub = {
  getClientCapabilities: async () => ({ passkeyPlatformAuthenticator: true }),
};

const offer = (accountHasPasskeys: boolean | undefined = undefined) =>
  passkeyPrompt.shouldOfferPasskeyPrompt({ accountId, accountHasPasskeys });

describe("passkey prompt eligibility", () => {
  beforeAll(async () => {
    GlobalRegistrator.register();
    originalDateNow = Date.now;
    passkeyPrompt = await import("./passkey-prompt");
  });

  beforeEach(() => {
    currentTime = Date.parse("2026-10-16T12:00:00.000Z");
    Date.now = () => currentTime;
    globalThis.sessionStorage.clear();
    globalThis.localStorage.clear();
    installPublicKeyCredential(capableBrowser);
  });

  afterEach(() => {
    Date.now = originalDateNow;
    Reflect.deleteProperty(globalThis, "PublicKeyCredential");
  });

  afterAll(() => {
    GlobalRegistrator.unregister();
  });

  test("offers once after an email sign-in on a capable browser", async () => {
    passkeyPrompt.noteEmailSignInForPasskeyPrompt();

    await expect(offer()).resolves.toBe(true);
    // A reload or a repeated effect run doesn't offer it again.
    await expect(offer()).resolves.toBe(false);
  });

  test("doesn't offer without a recent email sign-in in this tab", async () => {
    await expect(offer()).resolves.toBe(false);

    passkeyPrompt.noteEmailSignInForPasskeyPrompt();
    currentTime += tenMinutes;
    await expect(offer()).resolves.toBe(false);
  });

  test("never offers again on this device once dismissed for the account", async () => {
    passkeyPrompt.dismissPasskeyPrompt(accountId);
    passkeyPrompt.noteEmailSignInForPasskeyPrompt();
    await expect(offer(false)).resolves.toBe(false);

    passkeyPrompt.noteEmailSignInForPasskeyPrompt();
    await expect(
      passkeyPrompt.shouldOfferPasskeyPrompt({
        accountId: otherAccountId,
        accountHasPasskeys: false,
      })
    ).resolves.toBe(true);
  });

  test("doesn't offer when this browser holds a passkey for the account", async () => {
    passkeyPrompt.rememberPasskeyOnThisBrowser(accountId);
    passkeyPrompt.noteEmailSignInForPasskeyPrompt();
    await expect(offer(true)).resolves.toBe(false);

    passkeyPrompt.noteEmailSignInForPasskeyPrompt();
    await expect(offer(undefined)).resolves.toBe(false);
  });

  test("forgets a stale marker once the account has no passkeys", async () => {
    passkeyPrompt.rememberPasskeyOnThisBrowser(accountId);
    passkeyPrompt.noteEmailSignInForPasskeyPrompt();

    await expect(offer(false)).resolves.toBe(true);
    expect(
      globalThis.localStorage.getItem(`deskohub:passkey-held:${accountId}`)
    ).toBeNull();
  });

  test.each([
    ["no WebAuthn", undefined, false],
    [
      "client capabilities without a platform authenticator",
      { getClientCapabilities: async () => ({ conditionalGet: true }) },
      false,
    ],
    [
      "a user-verifying platform authenticator capability",
      {
        getClientCapabilities: async () => ({
          userVerifyingPlatformAuthenticator: true,
        }),
      },
      true,
    ],
    [
      "the older platform authenticator check",
      { isUserVerifyingPlatformAuthenticatorAvailable: async () => true },
      true,
    ],
    [
      "a rejecting capability check",
      {
        getClientCapabilities: () => Promise.reject(new Error("synthetic")),
      },
      false,
    ],
  ] as const)(
    "on a browser with %s, offers: %p",
    async (_name, stub, expected) => {
      installPublicKeyCredential(stub);
      passkeyPrompt.noteEmailSignInForPasskeyPrompt();

      await expect(offer()).resolves.toBe(expected);
    }
  );
});
