import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import {
  flushWorkspaceComponentWork,
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

type Occasion = "hydration" | "banner_save";
type Identity =
  | { readonly status: "anonymous" }
  | {
      readonly status: "authenticated";
      readonly accountId: ReturnType<typeof customerAccountIdSchema.make>;
      readonly testAccount: boolean;
    };

const recordDeviceAnalyticsConsent = mock(() =>
  Promise.resolve({ data: undefined })
);
let occasions: Occasion[] = [];
let identity: Identity = { status: "anonymous" };
let identityListeners: Array<() => void> = [];

mock.module("@/features/legal/actions", () => ({
  recordDeviceAnalyticsConsent,
  resolveSilentAnalyticsGrantForDevice: () => Promise.resolve({ data: null }),
}));

mock.module("@/shared/utils/use-workspace-action", () => ({
  useWorkspaceAction: () => ({
    execute: ({ occasion }: { readonly occasion: Occasion }) => {
      occasions.push(occasion);
    },
    executeAsync: () => Promise.resolve({ data: null }),
  }),
}));

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

const { AccountAnalyticsConsentMirror } = await import(
  "./account-analytics-consent-mirror"
);
const {
  CONSENT_UPDATED_EVENT,
  announceVisitorConsentChange,
  bindVisitorConsentRevision,
} = await import("@/features/cookie-consent/visitor-consent");

// The banner revision the page was served with in these tests.
const revision = 7;

const signedIn = (id: string): Identity => ({
  status: "authenticated",
  accountId: customerAccountIdSchema.make(id),
  testAccount: true,
});

const publishIdentity = (next: Identity) =>
  act(() => {
    identity = next;
    for (const listener of identityListeners) listener();
  });

/** Saves a consent cookie as the banner does, stamped at `savedAt`. */
const saveConsentCookie = (savedAt: string) => {
  // biome-ignore lint/suspicious/noDocumentCookie: The test saves the consent cookie the banner would.
  document.cookie = `cc_cookie=${encodeURIComponent(
    JSON.stringify({
      categories: ["necessary", "analytics"],
      revision,
      lastConsentTimestamp: savedAt,
    })
  )}; path=/`;
};

const clearConsentCookie = () => {
  // biome-ignore lint/suspicious/noDocumentCookie: The test clears consent between cases.
  document.cookie = "cc_cookie=; Path=/; Max-Age=0";
};

const mountMirror = async () => {
  render(<AccountAnalyticsConsentMirror />);
  await flushWorkspaceComponentWork();
};

beforeAll(() => {
  registerWorkspaceComponentTestEnv();
});

afterAll(async () => {
  await unregisterWorkspaceComponentTestEnv();
});

beforeEach(() => {
  bindVisitorConsentRevision(revision);
  window.happyDOM.setURL("https://deskohub.test/en-US/account");
  occasions = [];
  identity = { status: "anonymous" };
  identityListeners = [];
  clearConsentCookie();
});

afterEach(() => {
  cleanup();
});

describe("AccountAnalyticsConsentMirror", () => {
  test("mirrors the saved choice once for each account the session verifies", async () => {
    saveConsentCookie("2026-11-02T09:30:00.000Z");
    identity = signedIn("account-a");

    await mountMirror();
    await publishIdentity(signedIn("account-a"));
    expect(occasions).toEqual(["hydration"]);

    await publishIdentity({ status: "anonymous" });
    await publishIdentity(signedIn("account-b"));
    expect(occasions).toEqual(["hydration", "hydration"]);
  });

  test("mirrors nothing for a device without a saved choice", async () => {
    identity = signedIn("account-a");

    await mountMirror();

    expect(occasions).toEqual([]);
  });

  test("records a banner save in this tab while signed in", async () => {
    identity = signedIn("account-a");
    await mountMirror();

    act(() => {
      saveConsentCookie("2026-11-07T10:00:00.000Z");
      announceVisitorConsentChange();
    });

    expect(occasions).toEqual(["banner_save"]);
  });

  test("ignores the banner's page-load announcement of an unchanged choice", async () => {
    saveConsentCookie("2026-11-02T09:30:00.000Z");
    identity = signedIn("account-a");
    await mountMirror();

    act(() => announceVisitorConsentChange());

    expect(occasions).toEqual(["hydration"]);
  });

  test("records no banner save while signed out, and mirrors it at sign-in", async () => {
    await mountMirror();

    act(() => {
      saveConsentCookie("2026-11-07T10:00:00.000Z");
      announceVisitorConsentChange();
    });
    expect(occasions).toEqual([]);

    await publishIdentity(signedIn("account-a"));
    expect(occasions).toEqual(["hydration"]);
  });

  test("records no banner save for a change another tab made", async () => {
    identity = signedIn("account-a");
    await mountMirror();

    act(() => {
      saveConsentCookie("2026-11-07T10:00:00.000Z");
      window.dispatchEvent(new Event("focus"));
    });
    act(() => announceVisitorConsentChange());

    expect(occasions).toEqual([]);
  });

  test("records no banner save for the account's own grant applied to the device", async () => {
    identity = signedIn("account-a");
    await mountMirror();

    act(() => {
      saveConsentCookie("2026-11-02T09:30:00.000Z");
      window.dispatchEvent(
        new CustomEvent(CONSENT_UPDATED_EVENT, {
          detail: {
            _tag: "ConsentUpdated",
            acceptedCategories: ["necessary", "analytics"],
            change: "account",
          },
        })
      );
    });
    act(() => announceVisitorConsentChange());

    expect(occasions).toEqual([]);
  });
});
