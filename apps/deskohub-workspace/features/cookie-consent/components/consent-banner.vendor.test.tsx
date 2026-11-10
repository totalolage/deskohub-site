import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  mock,
  test,
} from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { act, cleanup, render } from "@testing-library/react";
import { Effect, Layer, Option } from "effect";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import { testSessionProfile } from "@/features/account/backend/customer-authentication.test-utils";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import { AnalyticsConsentLedger } from "@/features/legal/backend/analytics-consent-ledger";
import { resolveSilentAnalyticsGrant } from "@/features/legal/backend/analytics-consent-mirror";
import { getConsentBannerRevision } from "@/features/legal/consent-banner-revision";
import { getLegalDocumentVersion } from "@/features/legal/document-version";
import { getLegalDocumentPath } from "@/features/legal/legal-document-path";
import { CurrentWorkspaceRequestHeaders } from "@/shared/backend/workspace-request-context";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import {
  CONSENT_COOKIE_NAME,
  getAcceptedConsentCategoriesFromCookie,
  readConsentCookieChoice,
} from "@/shared/utils/consent-cookie";

// Other suites replace vanilla-cookieconsent with fakes in this process, so
// bind the real library through its file path.
const vendorPath = "vanilla-cookieconsent/dist/cookieconsent.esm.js";
const vendor: typeof import("vanilla-cookieconsent") = await import(vendorPath);
mock.module("vanilla-cookieconsent", () => vendor);

type Identity =
  | { readonly status: "pending" | "anonymous" }
  | {
      readonly status: "authenticated";
      readonly accountId: ReturnType<typeof customerAccountIdSchema.make>;
      readonly testAccount: boolean;
    };

let identity: Identity = { status: "anonymous" };
let identityListeners: Array<() => void> = [];
mock.module("@/features/account/analytics-identity", () => ({
  getAnalyticsAccountIdentity: () => identity,
  subscribeAnalyticsAccountIdentity: (listener: () => void) => {
    identityListeners.push(listener);
    return () => {
      identityListeners = identityListeners.filter(
        (other) => other !== listener
      );
    };
  },
}));

type SilentGrantAnswer = { readonly data: string | null };
// The server's answer to the banner's silent-grant question.
let answerSilentGrant: () => Promise<SilentGrantAnswer> = () =>
  Promise.resolve({ data: null });
const resolveSilentAnalyticsGrantForDevice = mock(() => answerSilentGrant());
mock.module("@/features/legal/actions", () => ({
  recordDeviceAnalyticsConsent: () => Promise.resolve({ data: false }),
  resolveSilentAnalyticsGrantForDevice,
}));
mock.module("@/shared/utils/use-workspace-action", () => ({
  useWorkspaceAction: (action: () => Promise<SilentGrantAnswer>) => ({
    execute: () => void action(),
    executeAsync: action,
  }),
}));

const { CONSENT_UPDATED_STORAGE_KEY, visitorConsent } = await import(
  "../visitor-consent"
);
const { ConsentBanner } = await import("./consent-banner");

const revision = getConsentBannerRevision();
const accepted = () =>
  getAcceptedConsentCategoriesFromCookie(document.cookie, { revision });
const bannerOpen = () =>
  document.documentElement.classList.contains("show--consent");

const accountId = customerAccountIdSchema.make("silent-grant-account");
const signedIn: Identity = {
  status: "authenticated",
  accountId,
  testAccount: true,
};
const publishIdentity = (next: Identity) =>
  act(async () => {
    identity = next;
    for (const listener of identityListeners) listener();
    await flushMicrotasks();
  });

// Another tab of the same browser rewrites the shared cookie and pings.
function changeConsentInAnotherTab(categories: readonly string[]) {
  const cookie = vendor.getCookie();
  // biome-ignore lint/suspicious/noDocumentCookie: The test plays another tab writing the shared consent cookie.
  document.cookie = `${CONSENT_COOKIE_NAME}=${encodeURIComponent(
    JSON.stringify({ ...cookie, categories })
  )}; Path=/; Domain=${location.hostname}`;
  window.dispatchEvent(
    new StorageEvent("storage", { key: CONSENT_UPDATED_STORAGE_KEY })
  );
}

const consentEvents = () =>
  (window.dataLayer ?? []).filter(
    (entry) => !Array.isArray(entry) || entry[0] === "consent"
  );

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeAll(() => {
  registerWorkspaceComponentTestEnv();
  // happy-dom reports an automated browser, for which the vendor's default
  // hideFromBots never renders the banner; emulate an ordinary browser.
  Object.defineProperty(navigator, "webdriver", {
    configurable: true,
    get: () => false,
  });
});
beforeEach(() => {
  identity = { status: "anonymous" };
  answerSilentGrant = () => Promise.resolve({ data: null });
  resolveSilentAnalyticsGrantForDevice.mockClear();
  window.happyDOM.setURL("https://deskohub.test/en-US");
  window.dataLayer = [];
  window.gtag = undefined;
});
afterEach(() => {
  cleanup();
  vendor.reset(true);
});
afterAll(() => {
  Reflect.deleteProperty(navigator, "webdriver");
  return unregisterWorkspaceComponentTestEnv();
});

test("a withdrawal in a tab that remembers the withdrawn state persists and denies Google consent", async () => {
  const view = render(<ConsentBanner locale="en-US" revision={revision} />);
  await act(async () => {
    vendor.acceptCategory([]);
    await flushMicrotasks();
  });
  expect(accepted()).toEqual(["necessary"]);
  // A locale change re-runs the banner effect while the vendor stays
  // initialized.
  view.rerender(<ConsentBanner locale="cs-CZ" revision={revision} />);

  changeConsentInAnotherTab(["necessary", "analytics"]);
  expect(visitorConsent.accepts("analytics")).toBe(true);
  expect(consentEvents().at(-3)).toEqual([
    "consent",
    "update",
    { analytics_storage: "granted" },
  ]);

  window.dataLayer = [];
  await act(async () => {
    visitorConsent.reject("analytics");
    await flushMicrotasks();
  });

  expect(accepted()).toEqual(["necessary"]);
  expect(consentEvents()).toEqual([
    ["consent", "update", { analytics_storage: "denied" }],
    [
      "consent",
      "update",
      {
        ad_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied",
      },
    ],
    ["consent", "update", { personalization_storage: "denied" }],
    { event: "consent_update" },
  ]);
});

test("a vendor-saved change keeps the existing update and event sequence", async () => {
  render(<ConsentBanner locale="en-US" revision={revision} />);
  await act(async () => {
    vendor.acceptCategory([]);
    await flushMicrotasks();
  });

  window.dataLayer = [];
  await act(async () => {
    visitorConsent.accept("marketing");
    await flushMicrotasks();
  });

  expect(accepted()).toEqual(["necessary", "marketing"]);
  expect(consentEvents()).toEqual([
    ["consent", "update", { analytics_storage: "denied" }],
    [
      "consent",
      "update",
      {
        ad_storage: "granted",
        ad_user_data: "granted",
        ad_personalization: "granted",
      },
    ],
    ["consent", "update", { personalization_storage: "denied" }],
    { event: "consent_update" },
  ]);
});

describe("silent grant", () => {
  const grantedAt = "2026-11-02T09:30:00.123Z";

  /** Renders the banner for a signed-in device without a consent cookie. */
  const renderSignedIn = async () => {
    identity = signedIn;
    render(<ConsentBanner locale="en-US" revision={revision} />);
    await act(async () => {
      await flushMicrotasks();
      await flushMicrotasks();
    });
  };

  test("a device without a consent cookie takes the account's current-notice grant: analytics only, dated at the grant, and no banner", async () => {
    answerSilentGrant = () => Promise.resolve({ data: grantedAt });
    // Each announcement with whether the device held a consent cookie then.
    const changes: Array<readonly [string, boolean]> = [];
    const stopFollowing = visitorConsent.subscribe((change) =>
      changes.push([change, visitorConsent.saveMark() !== ""])
    );

    try {
      await renderSignedIn();
    } finally {
      stopFollowing();
    }

    expect(accepted()).toEqual(["necessary", "analytics"]);
    const choice = readConsentCookieChoice(document.cookie, { revision });
    expect(
      Option.getOrUndefined(
        Option.flatMap(choice, (saved) =>
          Option.map(saved.lastConsentAt, String)
        )
      )
    ).toBe("2026-11-02T09:30:00.123Z");
    expect(bannerOpen()).toBe(false);
    // Only the page-load announcement precedes the grant, which is announced
    // once as the account's, never as a banner save.
    expect(changes).toEqual([
      ["local", false],
      ["account", true],
    ]);
  });

  test("an account whose grant was for an earlier notice and an account without a decision see the same banner", async () => {
    // The server's real rule over a ledger holding each account's decision.
    const answerFrom =
      (
        current: Effect.Success<
          ReturnType<AnalyticsConsentLedger["Service"]["currentDecision"]>
        >
      ) =>
      () =>
        Effect.runPromise(
          resolveSilentAnalyticsGrant().pipe(
            Effect.map((grant) => ({
              data: Option.getOrNull(Option.map(grant, String)),
            })),
            Effect.provideService(
              CurrentWorkspaceRequestHeaders,
              new Headers({ cookie: document.cookie })
            ),
            Effect.provide(
              Layer.mergeAll(
                Layer.succeed(AnalyticsConsentLedger, {
                  record: () => Effect.die("unused"),
                  mirror: () => Effect.die("unused"),
                  currentDecision: () => Effect.succeed(current),
                }),
                Layer.succeed(CustomerAuthentication, {
                  currentUser: Effect.succeed({
                    accountId,
                    deletionRequested: false,
                    ...testSessionProfile,
                    email: testEmailAddress("silent-grant"),
                  }),
                })
              )
            )
          )
        );

    const renderedBanner = async (
      current: Parameters<typeof answerFrom>[0]
    ) => {
      answerSilentGrant = answerFrom(current);
      await renderSignedIn();
      const banner = {
        open: bannerOpen(),
        markup: document.getElementById("cc-main")?.innerHTML,
        accepted: accepted(),
      };
      cleanup();
      vendor.reset(true);
      return banner;
    };

    const olderNoticeGrant = await renderedBanner(
      Option.some({
        decision: "grant",
        documentHash: "an-earlier-privacy-notice",
        locale: "en-US",
        decidedAt: Temporal.Instant.from(grantedAt),
        source: "banner",
      })
    );
    const noDecision = await renderedBanner(Option.none());

    expect(olderNoticeGrant.open).toBe(true);
    expect(olderNoticeGrant.accepted).toEqual([]);
    expect(olderNoticeGrant).toEqual(noDecision);

    // The same server rule does grant a current-notice decision.
    const currentNoticeGrant = await renderedBanner(
      Option.some({
        decision: "grant",
        documentHash: getLegalDocumentVersion("en-US", "privacy-policy"),
        locale: "en-US",
        decidedAt: Temporal.Instant.from(grantedAt),
        source: "banner",
      })
    );
    expect(currentNoticeGrant.open).toBe(false);
    expect(currentNoticeGrant.accepted).toEqual(["necessary", "analytics"]);
  });

  test("a signed-in account the server gives no silent grant, such as a withdrawn one, sees the banner and accepts nothing", async () => {
    await renderSignedIn();

    expect(bannerOpen()).toBe(true);
    expect(accepted()).toEqual([]);
  });

  test("the banner waits for the session, then opens for a signed-out device", async () => {
    identity = { status: "pending" };
    render(<ConsentBanner locale="en-US" revision={revision} />);
    await act(flushMicrotasks);
    expect(bannerOpen()).toBe(false);

    await publishIdentity({ status: "anonymous" });

    expect(bannerOpen()).toBe(true);
    expect(resolveSilentAnalyticsGrantForDevice).not.toHaveBeenCalled();
  });

  test("signing in while the banner is open applies the account's grant and closes it", async () => {
    render(<ConsentBanner locale="en-US" revision={revision} />);
    await act(flushMicrotasks);
    expect(bannerOpen()).toBe(true);

    answerSilentGrant = () => Promise.resolve({ data: grantedAt });
    await publishIdentity(signedIn);

    expect(bannerOpen()).toBe(false);
    expect(accepted()).toEqual(["necessary", "analytics"]);
  });

  test("an answer that arrives after sign-out changes nothing", async () => {
    let answer: (value: SilentGrantAnswer) => void = () => undefined;
    answerSilentGrant = () =>
      new Promise((resolve) => {
        answer = resolve;
      });
    await renderSignedIn();

    await publishIdentity({ status: "anonymous" });
    await act(async () => {
      answer({ data: grantedAt });
      await flushMicrotasks();
    });

    expect(accepted()).toEqual([]);
    expect(bannerOpen()).toBe(true);
  });

  test("an answer that arrives while the session refetches applies once the session returns to the account", async () => {
    let answer: (value: SilentGrantAnswer) => void = () => undefined;
    answerSilentGrant = () =>
      new Promise((resolve) => {
        answer = resolve;
      });
    await renderSignedIn();

    await publishIdentity({ status: "pending" });
    await act(async () => {
      answer({ data: grantedAt });
      await flushMicrotasks();
    });
    expect(accepted()).toEqual([]);
    await publishIdentity(signedIn);

    expect(accepted()).toEqual(["necessary", "analytics"]);
    expect(bannerOpen()).toBe(false);
    expect(resolveSilentAnalyticsGrantForDevice).toHaveBeenCalledTimes(1);
  });

  test("a device left waiting for the account's answer sees the banner after the wait, and a late grant still applies", async () => {
    let answer: (value: SilentGrantAnswer) => void = () => undefined;
    answerSilentGrant = () =>
      new Promise((resolve) => {
        answer = resolve;
      });
    jest.useFakeTimers();
    try {
      identity = signedIn;
      render(<ConsentBanner locale="en-US" revision={revision} />);
      await act(async () => {
        jest.advanceTimersByTime(0);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(resolveSilentAnalyticsGrantForDevice).toHaveBeenCalledTimes(1);
      expect(bannerOpen()).toBe(false);

      await act(async () => {
        jest.advanceTimersByTime(5000);
      });
      expect(bannerOpen()).toBe(true);
    } finally {
      jest.useRealTimers();
    }

    await act(async () => {
      answer({ data: grantedAt });
      await flushMicrotasks();
    });
    expect(bannerOpen()).toBe(false);
    expect(accepted()).toEqual(["necessary", "analytics"]);
  });

  test("a device holding a cookie from an earlier revision sees the banner without asking the account", async () => {
    answerSilentGrant = () => Promise.resolve({ data: grantedAt });
    // biome-ignore lint/suspicious/noDocumentCookie: The test seeds a choice saved before the banner was bound to the documents.
    document.cookie = `${CONSENT_COOKIE_NAME}=${encodeURIComponent(
      JSON.stringify({
        categories: ["necessary", "analytics"],
        revision: 0,
        consentId: "pre-binding-consent",
        consentTimestamp: "2026-10-01T08:00:00.000Z",
        lastConsentTimestamp: "2026-10-01T08:00:00.000Z",
      })
    )}; Path=/`;

    await renderSignedIn();

    expect(bannerOpen()).toBe(true);
    expect(accepted()).toEqual([]);
    expect(resolveSilentAnalyticsGrantForDevice).not.toHaveBeenCalled();
  });
});

describe("account decision", () => {
  const decidedAt = "2026-11-08T21:15:42.123Z";
  const savedAt = () =>
    Option.getOrUndefined(
      Option.flatMap(
        readConsentCookieChoice(document.cookie, { revision }),
        (saved) => Option.map(saved.lastConsentAt, String)
      )
    );

  /** Renders the banner for a signed-out device, as the vendor first sees it. */
  const renderDevice = async () => {
    render(<ConsentBanner locale="en-US" revision={revision} />);
    await act(flushMicrotasks);
  };

  /** Applies `decision` and returns every change announced meanwhile. */
  const applyDecision = async (
    decision: Parameters<typeof visitorConsent.applyAccountDecision>[0]
  ) => {
    const changes: string[] = [];
    const stopFollowing = visitorConsent.subscribe((change) =>
      changes.push(change)
    );
    try {
      await act(async () => {
        visitorConsent.applyAccountDecision(decision);
        await flushMicrotasks();
      });
    } finally {
      stopFollowing();
    }
    return changes;
  };

  test("on a device with a choice, a decline and then an accept change only analytics, each dated at its decision and announced once as its change", async () => {
    await renderDevice();
    await act(async () => {
      vendor.acceptCategory(["analytics", "marketing"]);
      await flushMicrotasks();
    });
    expect(accepted()).toEqual(["necessary", "analytics", "marketing"]);

    const signalBeforeDecline = localStorage.getItem(
      CONSENT_UPDATED_STORAGE_KEY
    );
    const declineChanges = await applyDecision({
      analytics: false,
      decidedAt,
      change: "preference",
    });

    expect(accepted()).toEqual(["necessary", "marketing"]);
    expect(savedAt()).toBe(decidedAt);
    expect(declineChanges).toEqual(["preference"]);
    // Other tabs are told, so their analytics sessions reconcile too.
    expect(localStorage.getItem(CONSENT_UPDATED_STORAGE_KEY)).not.toBe(
      signalBeforeDecline
    );

    const acceptedAt = "2026-11-08T21:20:00.456Z";
    const acceptChanges = await applyDecision({
      analytics: true,
      decidedAt: acceptedAt,
      change: "account",
    });

    expect(accepted()).toEqual(["necessary", "analytics", "marketing"]);
    expect(savedAt()).toBe(acceptedAt);
    expect(acceptChanges).toEqual(["account"]);
  });

  test("on a device without a choice, a decline saves every optional category declined, dated at the decision, and closes the banner", async () => {
    await renderDevice();
    expect(bannerOpen()).toBe(true);
    expect(visitorConsent.hasChoice()).toBe(false);

    const changes = await applyDecision({
      analytics: false,
      decidedAt,
      change: "preference",
    });

    expect(visitorConsent.hasChoice()).toBe(true);
    expect(accepted()).toEqual(["necessary"]);
    expect(savedAt()).toBe(decidedAt);
    expect(changes).toEqual(["preference"]);
    expect(bannerOpen()).toBe(false);
  });

  test("on a device without a choice, an accept saves analytics alone, dated at the decision, and closes the banner", async () => {
    await renderDevice();
    expect(bannerOpen()).toBe(true);

    const changes = await applyDecision({
      analytics: true,
      decidedAt,
      change: "preference",
    });

    expect(accepted()).toEqual(["necessary", "analytics"]);
    expect(savedAt()).toBe(decidedAt);
    expect(changes).toEqual(["preference"]);
    expect(bannerOpen()).toBe(false);
  });

  test("a decline in a tab that still remembers the declined set, after another tab accepted analytics, persists", async () => {
    await renderDevice();
    await act(async () => {
      vendor.acceptCategory([]);
      await flushMicrotasks();
    });
    changeConsentInAnotherTab(["necessary", "analytics"]);
    expect(visitorConsent.accepts("analytics")).toBe(true);

    const changes = await applyDecision({
      analytics: false,
      decidedAt,
      change: "account",
    });

    expect(accepted()).toEqual(["necessary"]);
    expect(savedAt()).toBe(decidedAt);
    expect(changes).toEqual(["account"]);
  });

  test.each([
    ["an accept", true, ["necessary", "analytics"]],
    ["a decline", false, ["necessary"]],
  ] as const)(
    "%s on a device whose cookie another tab removed while this tab's vendor still holds its consent rewrites a whole cookie",
    async (_decision, analytics, expected) => {
      await renderDevice();
      await act(async () => {
        vendor.acceptCategory(["analytics"]);
        await flushMicrotasks();
      });
      // Another tab of the same browser removes the shared cookie.
      for (const scope of ["Path=/", `Path=/; Domain=${location.hostname}`]) {
        // biome-ignore lint/suspicious/noDocumentCookie: The test plays another tab removing the shared consent cookie.
        document.cookie = `${CONSENT_COOKIE_NAME}=; ${scope}; Max-Age=0`;
      }
      expect(vendor.validConsent()).toBe(true);
      expect(visitorConsent.hasChoice()).toBe(false);

      const changes = await applyDecision({
        analytics,
        decidedAt,
        change: "preference",
      });

      expect(vendor.getCookie()).toMatchObject({
        categories: expect.any(Array),
        revision,
        lastConsentTimestamp: decidedAt,
      });
      expect(accepted()).toEqual([...expected]);
      expect(savedAt()).toBe(decidedAt);
      expect(changes).toEqual(["preference"]);
    }
  );
});

test("both modals link the privacy notice and the cookie policy of the page's locale as separate links of a link group", async () => {
  render(<ConsentBanner locale="cs-CZ" revision={revision} />);
  await act(async () => {
    vendor.show(true);
    vendor.showPreferences();
    await flushMicrotasks();
  });

  const documentPaths = [
    getLegalDocumentPath("cs-CZ", "privacy-policy"),
    getLegalDocumentPath("cs-CZ", "cookie-policy"),
  ];
  for (const modal of [".cm__footer", ".pm__body"]) {
    const groups = document.querySelectorAll(
      `#cc-main ${modal} .cm__link-group`
    );
    expect(groups).toHaveLength(1);
    expect(
      [...(groups[0]?.children ?? [])].map((link) => link.getAttribute("href"))
    ).toEqual(documentPaths);
  }
});

test("a page served with a new revision saves the next choice under it", async () => {
  const view = render(<ConsentBanner locale="en-US" revision={revision} />);
  await act(flushMicrotasks);

  view.rerender(<ConsentBanner locale="en-US" revision={revision + 1} />);
  await act(async () => {
    await flushMicrotasks();
    vendor.acceptCategory([]);
    await flushMicrotasks();
  });

  expect(vendor.getCookie("revision")).toBe(revision + 1);
  expect(visitorConsent.hasChoice()).toBe(true);
  expect(
    getAcceptedConsentCategoriesFromCookie(document.cookie, {
      revision: revision + 1,
    })
  ).toEqual(["necessary"]);
});
