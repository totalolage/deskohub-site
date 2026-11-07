import { describe, expect, test } from "bun:test";
import {
  analyticsConsentStatusOf,
  type ConsentCategory,
  type ConsentStorage,
  createAnalyticsConsent,
  type StoredConsent,
  withAnalyticsChoice,
} from "./analytics-consent";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const memoryStorage = (initial: StoredConsent) => {
  let stored = initial;
  let external: (() => void) | undefined;
  const writes: (readonly ConsentCategory[])[] = [];
  const storage: ConsentStorage = {
    read: () => stored,
    write: async (categories) => {
      writes.push(categories);
      stored = { kind: "decided", categories };
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
    expect(createAnalyticsConsent(storage, () => {}).status()).toBe(
      "undecided"
    );
  });

  test("is loading until an asynchronous answer arrives", async () => {
    const consent = createAnalyticsConsent(
      {
        read: async () => ({ kind: "decided", categories: ["analytics"] }),
        write: async () => {},
      },
      () => {}
    );
    expect(consent.status()).toBe("loading");
    await settle();
    expect(consent.status()).toBe("granted");
  });

  test("fails closed when storage cannot be read", async () => {
    const warnings: string[] = [];
    const rejected = createAnalyticsConsent(
      {
        read: () => Promise.reject(new Error("disk")),
        write: async () => {},
      },
      (message) => warnings.push(message)
    );
    const thrown = createAnalyticsConsent(
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
    const consent = createAnalyticsConsent(storage, () => {});
    let notifications = 0;
    consent.subscribe(() => notifications++);

    consent.grant();
    expect(consent.status()).toBe("undecided");
    await settle();
    expect(consent.status()).toBe("granted");
    consent.deny();
    expect(consent.status()).toBe("denied");
    expect(writes).toEqual([["necessary", "analytics"], ["necessary"]]);
    expect(notifications).toBe(2);
  });

  test("follows an answer changed outside the app", () => {
    const { storage, changeOutside } = memoryStorage({
      kind: "decided",
      categories: ["necessary", "analytics"],
    });
    const consent = createAnalyticsConsent(storage, () => {});
    changeOutside({ kind: "decided", categories: ["necessary"] });
    expect(consent.status()).toBe("denied");
  });

  test("keeps an answer given while an earlier read is in flight", async () => {
    const consent = createAnalyticsConsent(
      { read: async () => ({ kind: "undecided" }), write: async () => {} },
      () => {}
    );
    consent.deny();
    await settle();
    expect(consent.status()).toBe("denied");
  });

  test("declines when saving a grant fails", async () => {
    const warnings: string[] = [];
    const consent = createAnalyticsConsent(
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
