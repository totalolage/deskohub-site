import { describe, expect, test } from "bun:test";
import {
  type AnalyticsConsent,
  analyticsConsentStatusOf,
  type ConsentChange,
  type ConsentChoice,
  type ConsentStorage,
  consentChoiceMark,
  createAnalyticsConsent,
  type StoredConsent,
  withAnalyticsChoice,
} from "./analytics-consent";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const now = new Date("2026-11-10T12:00:00.000Z");

const create = (
  storage: ConsentStorage,
  warn: (message: string) => void = () => {}
) =>
  createAnalyticsConsent(storage, warn, {
    now: () => now,
    locale: () => "cs-CZ",
  });

const memoryStorage = (initial: StoredConsent) => {
  let stored = initial;
  let external: (() => void) | undefined;
  const writes: ConsentChoice[] = [];
  const storage: ConsentStorage = {
    read: () => stored,
    write: async (choice) => {
      writes.push(choice);
      stored = { kind: "decided", ...choice };
    },
    watch: (listener) => {
      external = listener;
      return () => {
        external = undefined;
      };
    },
  };
  return {
    storage,
    writes,
    changeOutside: (next: StoredConsent) => {
      stored = next;
      external?.();
    },
  };
};

describe("analyticsConsentStatusOf", () => {
  test("tells no answer apart from a refusal", () => {
    expect(analyticsConsentStatusOf({ kind: "undecided" })).toBe("undecided");
    expect(
      analyticsConsentStatusOf({ kind: "decided", categories: ["necessary"] })
    ).toBe("denied");
    expect(
      analyticsConsentStatusOf({
        kind: "decided",
        categories: ["necessary", "analytics"],
      })
    ).toBe("granted");
  });
});

describe("withAnalyticsChoice", () => {
  test("stores only the necessary categories with no earlier answer", () => {
    expect(withAnalyticsChoice({ kind: "undecided" }, true)).toEqual([
      "necessary",
      "analytics",
    ]);
    expect(withAnalyticsChoice({ kind: "undecided" }, false)).toEqual([
      "necessary",
    ]);
  });

  test("keeps the other categories of an earlier answer", () => {
    const earlier: StoredConsent = {
      kind: "decided",
      categories: ["necessary", "analytics", "marketing"],
    };
    expect(withAnalyticsChoice(earlier, false)).toEqual([
      "necessary",
      "marketing",
    ]);
    expect(
      withAnalyticsChoice(
        { kind: "decided", categories: ["preferences"] },
        true
      )
    ).toEqual(["necessary", "preferences", "analytics"]);
  });
});

describe("createAnalyticsConsent", () => {
  test("reads a synchronous answer at once", () => {
    const { storage } = memoryStorage({ kind: "undecided" });
    expect(create(storage).status()).toBe("undecided");
  });

  test("is loading until an asynchronous answer arrives", async () => {
    const consent = create({
      read: async () => ({ kind: "decided", categories: ["analytics"] }),
      write: async () => {},
    });
    expect(consent.status()).toBe("loading");
    await settle();
    expect(consent.status()).toBe("granted");
  });

  test("fails closed when storage cannot be read", async () => {
    const warnings: string[] = [];
    const rejected = create(
      {
        read: () => Promise.reject(new Error("disk")),
        write: async () => {},
      },
      (message) => warnings.push(message)
    );
    const thrown = create(
      {
        read: () => {
          throw new Error("blocked");
        },
        write: async () => {},
      },
      (message) => warnings.push(message)
    );
    await settle();
    expect(rejected.status()).toBe("denied");
    expect(thrown.status()).toBe("denied");
    expect(warnings).toHaveLength(2);
  });

  test("grants once saved and withdraws at once, notifying each change", async () => {
    const { storage, writes } = memoryStorage({ kind: "undecided" });
    const consent = create(storage);
    const changes: ConsentChange[] = [];
    consent.subscribe((change) => changes.push(change));

    consent.grant();
    expect(consent.status()).toBe("undecided");
    await settle();
    expect(consent.status()).toBe("granted");
    consent.deny();
    expect(consent.status()).toBe("denied");
    expect(writes).toEqual([
      {
        categories: ["necessary", "analytics"],
        decidedAt: "2026-11-10T12:00:00.000Z",
        locale: "cs-CZ",
      },
      {
        categories: ["necessary"],
        decidedAt: "2026-11-10T12:00:00.000Z",
        locale: "cs-CZ",
      },
    ]);
    expect(changes).toEqual(["local", "local"]);
  });

  test("keeps the saved choice's date and language", async () => {
    const { storage } = memoryStorage({ kind: "undecided" });
    const consent = create(storage);
    consent.grant();
    await settle();
    expect(consent.current()).toEqual({
      kind: "decided",
      categories: ["necessary", "analytics"],
      decidedAt: "2026-11-10T12:00:00.000Z",
      locale: "cs-CZ",
    });
  });

  test("follows an answer changed outside the app", () => {
    const { storage, changeOutside } = memoryStorage({
      kind: "decided",
      categories: ["necessary", "analytics"],
    });
    const consent = create(storage);
    changeOutside({ kind: "decided", categories: ["necessary"] });
    expect(consent.status()).toBe("denied");
  });

  test("keeps an answer given while an earlier read is in flight", async () => {
    const consent = create({
      read: async () => ({ kind: "undecided" }),
      write: async () => {},
    });
    consent.deny();
    await settle();
    expect(consent.status()).toBe("denied");
  });

  test("declines when saving a grant fails", async () => {
    const warnings: string[] = [];
    const consent = create(
      {
        read: () => ({ kind: "undecided" }),
        write: () => Promise.reject(new Error("full")),
      },
      (message) => warnings.push(message)
    );
    consent.grant();
    await settle();
    expect(consent.status()).toBe("denied");
    expect(warnings).toHaveLength(1);
  });
});

describe("applyAccountDecision", () => {
  const granted: StoredConsent = {
    kind: "decided",
    categories: ["necessary", "analytics", "marketing"],
    decidedAt: "2026-11-01T08:00:00.000Z",
    locale: "en-US",
  };

  const watch = (consent: AnalyticsConsent) => {
    const changes: ConsentChange[] = [];
    consent.subscribe((change) => changes.push(change));
    return changes;
  };

  test("withdraws at once, dated at the account's decision", async () => {
    const { storage, writes } = memoryStorage(granted);
    const consent = create(storage);
    const changes = watch(consent);

    const applying = consent.applyAccountDecision({
      analytics: false,
      decidedAt: "2026-11-09T07:15:30.123Z",
    });
    expect(consent.status()).toBe("denied");
    await applying;

    expect(writes).toEqual([
      {
        categories: ["necessary", "marketing"],
        decidedAt: "2026-11-09T07:15:30.123Z",
        locale: "cs-CZ",
      },
    ]);
    expect(changes).toEqual(["account"]);
  });

  test("grants silently with only the necessary categories besides analytics", async () => {
    const { storage, writes } = memoryStorage({ kind: "undecided" });
    const consent = create(storage);
    const changes = watch(consent);

    const applying = consent.applyAccountDecision({
      analytics: true,
      decidedAt: "2026-11-09T07:15:30.123Z",
    });
    expect(consent.status()).toBe("undecided");
    await applying;

    expect(consent.status()).toBe("granted");
    expect(writes).toEqual([
      {
        categories: ["necessary", "analytics"],
        decidedAt: "2026-11-09T07:15:30.123Z",
        locale: "cs-CZ",
      },
    ]);
    expect(changes).toEqual(["account"]);
  });

  test("notifies a new date even when the status stays", async () => {
    const { storage } = memoryStorage(granted);
    const consent = create(storage);
    const changes = watch(consent);

    await consent.applyAccountDecision({
      analytics: true,
      decidedAt: "2026-11-09T07:15:30.123Z",
    });

    expect(consent.status()).toBe("granted");
    expect(changes).toEqual(["account"]);
  });

  test("declines when saving the account's grant fails", async () => {
    const warnings: string[] = [];
    const consent = create(
      {
        read: () => ({ kind: "undecided" }),
        write: () => Promise.reject(new Error("full")),
      },
      (message) => warnings.push(message)
    );

    await consent.applyAccountDecision({
      analytics: true,
      decidedAt: "2026-11-09T07:15:30.123Z",
    });

    expect(consent.status()).toBe("denied");
    expect(warnings).toHaveLength(1);
  });
});

describe("consentChoiceMark", () => {
  const granted = (): Extract<StoredConsent, { kind: "decided" }> => ({
    kind: "decided",
    categories: ["necessary", "analytics"],
    decidedAt: "2026-11-01T08:00:00.000Z",
  });

  test("changes with the date or categories, not with a fresh read", () => {
    expect(consentChoiceMark({ ...granted() })).toBe(
      consentChoiceMark({ ...granted() })
    );
    expect(consentChoiceMark(granted())).not.toBe(
      consentChoiceMark({ ...granted(), decidedAt: "2026-11-02T08:00:00Z" })
    );
    expect(consentChoiceMark(granted())).not.toBe(
      consentChoiceMark({ ...granted(), categories: ["necessary"] })
    );
    expect(consentChoiceMark(undefined)).not.toBe(
      consentChoiceMark({ kind: "undecided" })
    );
  });
});
