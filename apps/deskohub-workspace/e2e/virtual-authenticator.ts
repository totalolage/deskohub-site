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
   * request. Presence answers a request that starts during a ceremony but
   * not one already pending, so a test that drives another ceremony waits
   * for the form's request first; a timeout that elapses shows that none
   * started. Only documents loaded after the authenticator was added are
   * watched.
   */
  readonly waitForConditionalRequest: (timeout: number) => Promise<void>;
  /**
   * Like `answerCeremony`, for a ceremony the customer starts with a button:
   * fails unless the only sign-in request answered meanwhile, across
   * navigations, is that modal one. With presence on, a conditional request
   * the page arms after a failed button ceremony would also be answered and
   * sign the customer in, hiding the failure.
   */
  readonly answerModalCeremony: <A>(ceremony: () => Promise<A>) => Promise<A>;
};

export type VirtualAuthenticatorSession = Pick<CDPSession, "detach" | "send">;

/** How a sign-in (`credentials.get`) request the page started settled. */
type WebAuthnSignInRequestOutcome = {
  readonly conditional: boolean;
  readonly answered: boolean;
};

const conditionalRequestCountKey = "deskohub.e2e.conditionalWebAuthnRequests";
const signInRequestBinding = "__deskohubE2EWebAuthnSignInRequestSettled";

/**
 * Runs in every new document: counts the conditional WebAuthn requests it
 * starts, reports how each sign-in request settles, and passes every request
 * on unchanged. Serialized into the page, so it references no module scope.
 */
const watchSignInRequests = ({
  countKey,
  binding,
}: {
  readonly countKey: string;
  readonly binding: string;
}) => {
  const count = Symbol.for(countKey);
  Reflect.set(globalThis, count, 0);
  const get = CredentialsContainer.prototype.get;
  CredentialsContainer.prototype.get = function (options) {
    const conditional = options?.mediation === "conditional";
    if (conditional) {
      Reflect.set(
        globalThis,
        count,
        Number(Reflect.get(globalThis, count)) + 1
      );
    }
    const request = get.call(this, options);
    if (options?.publicKey !== undefined) {
      const report = (answered: boolean) => {
        const settled = Reflect.get(globalThis, binding);
        if (typeof settled === "function") {
          void settled({ conditional, answered });
        }
      };
      request.then(
        (credential) => report(credential !== null),
        () => report(false)
      );
    }
    return request;
  };
};

const hasConditionalRequest = (key: string) =>
  Number(Reflect.get(globalThis, Symbol.for(key)) ?? 0) > 0;

/** A modal ceremony that did not sign in alone; the message is fixed text. */
export class ModalCeremonyNotAlone extends Error {}

/**
 * Fails unless `outcomes` answered exactly one sign-in request, a modal one.
 */
const requireOnlyModalSignInAnswered = (
  outcomes: readonly WebAuthnSignInRequestOutcome[]
) => {
  const answered = outcomes.filter((outcome) => outcome.answered);
  if (answered.some((outcome) => outcome.conditional)) {
    throw new ModalCeremonyNotAlone(
      "a conditional sign-in request was answered"
    );
  }
  if (answered.length !== 1) {
    throw new ModalCeremonyNotAlone(
      `${answered.length} modal sign-in requests were answered, not one`
    );
  }
};

/** Each page's sign-in request outcomes, recorded from its first watch. */
const watchedPages = new WeakMap<Page, WebAuthnSignInRequestOutcome[]>();

const watchPage = async (page: Page) => {
  const recorded = watchedPages.get(page);
  if (recorded !== undefined) return recorded;
  const outcomes: WebAuthnSignInRequestOutcome[] = [];
  watchedPages.set(page, outcomes);
  // Page-lifetime (Playwright cannot remove init scripts or bindings), and
  // strictly observational.
  await page.exposeFunction(signInRequestBinding, (outcome: unknown) => {
    if (
      typeof outcome === "object" &&
      outcome !== null &&
      "conditional" in outcome &&
      "answered" in outcome
    ) {
      outcomes.push({
        conditional: outcome.conditional === true,
        answered: outcome.answered === true,
      });
    }
  });
  await page.addInitScript(watchSignInRequests, {
    countKey: conditionalRequestCountKey,
    binding: signInRequestBinding,
  });
  return outcomes;
};

/**
 * Pages that hold a virtual authenticator. Detaching any CDP session from a
 * page resets Chromium's virtual authenticator environment for that page,
 * which removes the authenticator and every credential it stores, so other
 * CDP users leave their sessions attached on these pages.
 */
const authenticatorPages = new WeakSet<Page>();

export const holdsVirtualAuthenticator = (page: Page) =>
  authenticatorPages.has(page);

/**
 * Adds a virtual platform authenticator to one page's target. It serves that
 * page across navigations until `remove` runs or the page closes.
 */
export const addVirtualAuthenticator = async (
  page: Page
): Promise<PageVirtualAuthenticator> => {
  const outcomes = await watchPage(page);
  const authenticator = await attachVirtualAuthenticator(
    await page.context().newCDPSession(page)
  );
  authenticatorPages.add(page);
  return {
    ...authenticator,
    remove: async () => {
      try {
        await authenticator.remove();
      } finally {
        authenticatorPages.delete(page);
      }
    },
    waitForConditionalRequest: async (timeout) => {
      await page.waitForFunction(
        hasConditionalRequest,
        conditionalRequestCountKey,
        { timeout }
      );
    },
    answerModalCeremony: async (ceremony) => {
      const start = outcomes.length;
      const result = await authenticator.answerCeremony(ceremony);
      requireOnlyModalSignInAnswered(outcomes.slice(start));
      return result;
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
