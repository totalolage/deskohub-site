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

type HydrationResult = { readonly data?: string | null } | undefined;

// What the next hydration request settles with: the account's withdrawal to
// apply on this device (ISO 8601), or null when there is none.
let respondToHydration: () => Promise<HydrationResult> = () =>
  Promise.resolve({ data: null });

mock.module("@/shared/utils/use-workspace-action", () => ({
  useWorkspaceAction: () => ({
    execute: ({ occasion }: { readonly occasion: Occasion }) => {
      occasions.push(occasion);
    },
    executeAsync: ({ occasion }: { readonly occasion: Occasion }) => {
      occasions.push(occasion);
      return occasion === "hydration"
        ? respondToHydration()
        : Promise.resolve({ data: null });
    },
  }),
}));

// vanilla-cookieconsent 3.1.0 as the device's consent writer sees it: it
// saves a changed category set to the consent cookie, stamped now, and the
// banner then announces the save through its change callback.
let rememberedCategories: string[] = ["necessary"];

const readSavedCookie = () => {
  const entry = document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith("cc_cookie="));
  return entry
    ? (JSON.parse(decodeURIComponent(entry.slice("cc_cookie=".length))) as {
        readonly categories: string[];
        readonly lastConsentTimestamp: string;
        readonly revision: number;
      })
    : undefined;
};

const vendorSave = (categories: string[]) => {
  rememberedCategories = categories;
  writeConsentCookie(categories, new Date().toISOString());
  announceVisitorConsentChange();
};

mock.module("vanilla-cookieconsent", () => ({
  acceptCategory: (categories: string | string[]) => {
    const requested = [
      ...new Set([
        "necessary",
        ...(Array.isArray(categories) ? categories : [categories]),
      ]),
    ];
    const unchanged =
      requested.length === rememberedCategories.length &&
      requested.every((category) => rememberedCategories.includes(category));
    if (!unchanged) vendorSave(requested);
  },
  getConfig: () => undefined,
  getCookie: () => ({
    ...readSavedCookie(),
    expirationTime: Date.parse("2027-11-08T00:00:00.000Z"),
  }),
  getUserPreferences: () => ({ acceptedCategories: rememberedCategories }),
  hide: () => undefined,
  setCookieData: () => {
    vendorSave(rememberedCategories);
    return true;
  },
  validConsent: () => readSavedCookie()?.revision === revision,
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
  visitorConsent,
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

function writeConsentCookie(categories: string[], savedAt: string) {
  // biome-ignore lint/suspicious/noDocumentCookie: The test saves the consent cookie the banner would.
  document.cookie = `cc_cookie=${encodeURIComponent(
    JSON.stringify({ categories, revision, lastConsentTimestamp: savedAt })
  )}; path=/`;
}

/**
 * Saves a consent cookie accepting analytics as the banner does, stamped at
 * `savedAt`.
 */
const saveConsentCookie = (savedAt: string) => {
  rememberedCategories = ["necessary", "analytics"];
  writeConsentCookie(rememberedCategories, savedAt);
};

/**
 * Holds every later hydration request; the returned function settles the
 * `request`-th one (from 0) with `result`.
 */
const deferHydration = () => {
  const pending: Array<(result: HydrationResult) => void> = [];
  respondToHydration = () =>
    new Promise<HydrationResult>((resolve) => {
      pending.push(resolve);
    });
  return async (request: number, result: HydrationResult) => {
    await act(async () => pending[request]?.(result));
    await flushWorkspaceComponentWork();
  };
};

/** Every change this tab announced while `run` ran. */
const announcedChanges = async (run: () => Promise<void> | void) => {
  const changes: string[] = [];
  const record = (event: Event) =>
    changes.push((event as CustomEvent<{ change: string }>).detail.change);
  window.addEventListener(CONSENT_UPDATED_EVENT, record);
  try {
    await run();
  } finally {
    window.removeEventListener(CONSENT_UPDATED_EVENT, record);
  }
  return changes;
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
  respondToHydration = () => Promise.resolve({ data: null });
  rememberedCategories = ["necessary"];
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

  test("declines analytics on the device when the account withdrew after its choice", async () => {
    const withdrawnAt = "2026-11-08T10:15:30.123Z";
    saveConsentCookie("2026-11-02T09:30:00.000Z");
    identity = signedIn("account-a");
    respondToHydration = () => Promise.resolve({ data: withdrawnAt });

    const changes = await announcedChanges(mountMirror);

    expect(visitorConsent.accepts("analytics")).toBe(false);
    expect(readSavedCookie()).toMatchObject({
      categories: ["necessary"],
      revision,
      lastConsentTimestamp: withdrawnAt,
    });
    // Applied once as the account's decision, never as a banner save.
    expect(changes).toEqual(["account"]);
    expect(occasions).toEqual(["hydration"]);
  });

  test("leaves the device as it is when the account has no newer withdrawal", async () => {
    saveConsentCookie("2026-11-02T09:30:00.000Z");
    const saved = visitorConsent.saveMark();
    identity = signedIn("account-a");

    const changes = await announcedChanges(mountMirror);

    expect(visitorConsent.saveMark()).toBe(saved);
    expect(visitorConsent.accepts("analytics")).toBe(true);
    expect(changes).toEqual([]);
    expect(occasions).toEqual(["hydration"]);
  });

  test("leaves the device as it is when the mirror request fails", async () => {
    saveConsentCookie("2026-11-02T09:30:00.000Z");
    const saved = visitorConsent.saveMark();
    identity = signedIn("account-a");
    respondToHydration = () =>
      Promise.reject(new Error("Synthetic mirror failure"));

    const changes = await announcedChanges(mountMirror);

    expect(visitorConsent.saveMark()).toBe(saved);
    expect(changes).toEqual([]);
  });

  test("keeps a choice saved while the mirror request was in flight", async () => {
    saveConsentCookie("2026-11-02T09:30:00.000Z");
    identity = signedIn("account-a");
    const respond = deferHydration();
    await mountMirror();

    // Another tab saves a newer choice before the response arrives.
    saveConsentCookie("2026-11-08T10:20:00.000Z");
    const savedMeanwhile = visitorConsent.saveMark();
    const changes = await announcedChanges(() =>
      respond(0, { data: "2026-11-08T10:15:30.123Z" })
    );

    expect(visitorConsent.saveMark()).toBe(savedMeanwhile);
    expect(visitorConsent.accepts("analytics")).toBe(true);
    expect(changes).toEqual([]);
    expect(occasions).toEqual(["hydration"]);
  });

  test.each([
    { analytics: true, change: "account" },
    { analytics: false, change: "account" },
    { analytics: true, change: "preference" },
    { analytics: false, change: "preference" },
  ] as const)(
    "records no banner save for an account decision applied to the device ($change, analytics $analytics)",
    async ({ analytics, change }) => {
      saveConsentCookie("2026-11-02T09:30:00.000Z");
      rememberedCategories = analytics
        ? ["necessary"]
        : ["necessary", "analytics"];
      writeConsentCookie(rememberedCategories, "2026-11-02T09:30:00.000Z");
      identity = signedIn("account-a");
      await mountMirror();

      const changes = await announcedChanges(() =>
        act(() =>
          visitorConsent.applyAccountDecision({
            analytics,
            decidedAt: "2026-11-08T10:15:30.123Z",
            change,
          })
        )
      );

      expect(visitorConsent.accepts("analytics")).toBe(analytics);
      expect(changes).toEqual([change]);
      expect(occasions).toEqual(["hydration"]);
    }
  );

  test.each([
    { name: "signs out", next: { status: "anonymous" } as Identity },
    { name: "switches to another account", next: signedIn("account-b") },
  ])(
    "ignores a withdrawal that arrives after the session $name",
    async ({ next }) => {
      saveConsentCookie("2026-11-02T09:30:00.000Z");
      const saved = visitorConsent.saveMark();
      identity = signedIn("account-a");
      const respond = deferHydration();
      await mountMirror();

      await publishIdentity(next);
      const changes = await announcedChanges(() =>
        respond(0, { data: "2026-11-08T10:15:30.123Z" })
      );

      expect(visitorConsent.saveMark()).toBe(saved);
      expect(visitorConsent.accepts("analytics")).toBe(true);
      expect(changes).toEqual([]);
      // A newly signed-in account gets its own mirror.
      expect(occasions).toEqual(
        next.status === "authenticated"
          ? ["hydration", "hydration"]
          : ["hydration"]
      );
      await respond(1, { data: null });
    }
  );
});
