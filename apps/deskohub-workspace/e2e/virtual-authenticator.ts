import type { CDPSession, Page } from "@playwright/test";

/**
 * A platform passkey authenticator as Chromium's WebAuthn domain emulates it:
 * a CTAP2 internal authenticator that stores discoverable credentials and
 * verifies the user. It runs the browser's real origin and RP ID checks,
 * unlike Playwright's credential mocks, so a ceremony against the deployed
 * host proves its WebAuthn config.
 *
 * It starts without simulated presence. With presence on, Chromium answers a
 * conditional (autofill) request at once, so every sign-in form would sign
 * the customer straight back in. Without it, requests wait the way they do
 * for a customer who ignores the browser's passkey autofill, and a test turns
 * presence on only for the ceremony it drives.
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
   * stays pending.
   */
  readonly answerCeremony: <A>(ceremony: () => Promise<A>) => Promise<A>;
  /** Removes the authenticator and detaches its session; repeat calls no-op. */
  readonly remove: () => Promise<void>;
};

export type VirtualAuthenticatorSession = Pick<CDPSession, "detach" | "send">;

/**
 * Adds a virtual platform authenticator to one page's target. It serves that
 * page across navigations until `remove` runs or the page closes.
 */
export const addVirtualAuthenticator = async (
  page: Page
): Promise<VirtualAuthenticator> =>
  attachVirtualAuthenticator(await page.context().newCDPSession(page));

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
