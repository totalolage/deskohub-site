import type { CDPSession, Page } from "@playwright/test";

/**
 * A platform passkey authenticator as Chromium's WebAuthn domain emulates it:
 * a CTAP2 internal authenticator that stores discoverable credentials and
 * verifies the user. It runs the browser's real origin and RP ID checks,
 * unlike Playwright's credential mocks, so a ceremony against the deployed
 * host proves its WebAuthn config.
 *
 * It starts without simulated presence. With presence on, Chromium answers a
 * conditional (autofill) request as it starts, so every sign-in form would
 * sign the customer straight back in. Without it, requests wait the way they
 * do for a customer who ignores the browser's passkey autofill, and a test
 * turns presence on only for the ceremony it drives.
 */
export const virtualPlatformAuthenticatorOptions = {
  automaticPresenceSimulation: false,
  hasResidentKey: true,
  hasUserVerification: true,
  isUserVerified: true,
  protocol: "ctap2",
  transport: "internal",
} as const;

/**
 * What a test may read back about a stored credential. Credential IDs, user
 * handles, and private keys stay inside the authenticator.
 */
export type VirtualAuthenticatorCredential = {
  readonly isResidentCredential: boolean;
  readonly rpId: string | undefined;
};

export type VirtualAuthenticator = {
  readonly readCredentials: () => Promise<
    readonly VirtualAuthenticatorCredential[]
  >;
  /**
   * Simulates the customer's presence while `ceremony` runs, so the WebAuthn
   * requests it starts are answered. A conditional request already pending
   * stays pending, but one the page starts meanwhile is answered too.
   */
  readonly answerCeremony: <A>(ceremony: () => Promise<A>) => Promise<A>;
  /** Removes the authenticator and detaches its session; repeat calls no-op. */
  readonly remove: () => Promise<void>;
};

/** A virtual authenticator that also watches its page's WebAuthn requests. */
export type PageVirtualAuthenticator = VirtualAuthenticator & {
  /**
   * Waits until the current document has started a conditional (autofill)
   * request. A form arms one after hydration and a request for options, so
   * a ceremony answered before then answers the form's request as well and
   * signs the customer in through autofill. Only documents loaded after the
   * authenticator was added are watched.
   */
  readonly waitForConditionalRequest: (timeout: number) => Promise<void>;
};

export type VirtualAuthenticatorSession = Pick<CDPSession, "detach" | "send">;

const conditionalRequestCountKey = "deskohub.e2e.conditionalWebAuthnRequests";

/**
 * Runs in every new document: counts the conditional WebAuthn requests it
 * starts and passes every request on unchanged. Serialized into the page, so
 * it references no module scope.
 */
const countConditionalRequests = (key: string) => {
  const count = Symbol.for(key);
  Reflect.set(globalThis, count, 0);
  const get = CredentialsContainer.prototype.get;
  CredentialsContainer.prototype.get = function (options) {
    if (options?.mediation === "conditional") {
      Reflect.set(
        globalThis,
        count,
        Number(Reflect.get(globalThis, count)) + 1
      );
    }
    return get.call(this, options);
  };
};

const hasConditionalRequest = (key: string) =>
  Number(Reflect.get(globalThis, Symbol.for(key)) ?? 0) > 0;

/**
 * Adds a virtual platform authenticator to one page's target. It serves that
 * page across navigations until `remove` runs or the page closes.
 */
export const addVirtualAuthenticator = async (
  page: Page
): Promise<PageVirtualAuthenticator> => {
  // Page-lifetime (Playwright cannot remove init scripts), and strictly
  // observational.
  await page.addInitScript(
    countConditionalRequests,
    conditionalRequestCountKey
  );
  const authenticator = await attachVirtualAuthenticator(
    await page.context().newCDPSession(page)
  );
  return {
    ...authenticator,
    waitForConditionalRequest: async (timeout) => {
      await page.waitForFunction(
        hasConditionalRequest,
        conditionalRequestCountKey,
        { timeout }
      );
    },
  };
};

export const attachVirtualAuthenticator = async (
  session: VirtualAuthenticatorSession
): Promise<VirtualAuthenticator> => {
  let authenticatorId: string;
  try {
    await session.send("WebAuthn.enable", { enableUI: false });
    ({ authenticatorId } = await session.send(
      "WebAuthn.addVirtualAuthenticator",
      { options: virtualPlatformAuthenticatorOptions }
    ));
  } catch (cause) {
    await session.detach().catch(() => undefined);
    throw cause;
  }

  const setPresence = (enabled: boolean) =>
    session.send("WebAuthn.setAutomaticPresenceSimulation", {
      authenticatorId,
      enabled,
    });

  let removal: Promise<void> | undefined;
  return {
    answerCeremony: async (ceremony) => {
      await setPresence(true);
      try {
        return await ceremony();
      } finally {
        await setPresence(false);
      }
    },
    readCredentials: async () => {
      const { credentials } = await session.send("WebAuthn.getCredentials", {
        authenticatorId,
      });
      return credentials.map((credential) => ({
        isResidentCredential: credential.isResidentCredential,
        rpId: credential.rpId,
      }));
    },
    remove: () => {
      removal ??= (async () => {
        try {
          await session.send("WebAuthn.removeVirtualAuthenticator", {
            authenticatorId,
          });
          await session.send("WebAuthn.disable");
        } finally {
          await session.detach();
        }
      })();
      return removal;
    },
  };
};
