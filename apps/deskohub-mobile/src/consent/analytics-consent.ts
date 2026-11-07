/** The site's consent categories (`shared/utils/consent-cookie.ts`). */
export const consentCategories = [
  "necessary",
  "analytics",
  "marketing",
  "preferences",
] as const;

export type ConsentCategory = (typeof consentCategories)[number];

export const isConsentCategory = (value: unknown): value is ConsentCategory =>
  consentCategories.some((category) => category === value);

/** A stored consent answer, or none yet. */
export type StoredConsent =
  | { readonly kind: "undecided" }
  | {
      readonly kind: "decided";
      readonly categories: readonly ConsentCategory[];
    };

/**
 * Whether analytics may run. `loading` until the stored answer is read;
 * `undecided` when there is none, which shows the consent prompt.
 */
export type AnalyticsConsentStatus =
  | "loading"
  | "undecided"
  | "granted"
  | "denied";

export const analyticsConsentStatusOf = (
  consent: StoredConsent
): Exclude<AnalyticsConsentStatus, "loading"> => {
  if (consent.kind === "undecided") return "undecided";
  return consent.categories.includes("analytics") ? "granted" : "denied";
};

/**
 * The categories a new analytics answer stores: the earlier choice for the
 * other categories, or only the necessary ones when there was none.
 */
export const withAnalyticsChoice = (
  consent: StoredConsent,
  granted: boolean
): readonly ConsentCategory[] => {
  const others =
    consent.kind === "decided"
      ? consent.categories.filter((category) => category !== "analytics")
      : [];
  const kept: readonly ConsentCategory[] = others.includes("necessary")
    ? others
    : ["necessary", ...others];
  return granted ? [...kept, "analytics"] : kept;
};

/** Where a platform keeps the consent answer. */
export interface ConsentStorage {
  /** The stored answer. A thrown error reads as declined. */
  readonly read: () => StoredConsent | Promise<StoredConsent>;
  readonly write: (categories: readonly ConsentCategory[]) => Promise<void>;
  /**
   * Calls the listener when the answer may have changed outside the app,
   * such as on the site. Returns the unsubscribe function.
   */
  readonly watch?: (listener: () => void) => () => void;
}

export interface AnalyticsConsent {
  readonly status: () => AnalyticsConsentStatus;
  readonly subscribe: (listener: () => void) => () => void;
  readonly grant: () => void;
  readonly deny: () => void;
  /** Reads the stored answer again. */
  readonly refresh: () => void;
}

const declined: StoredConsent = { kind: "decided", categories: ["necessary"] };

/**
 * The analytics consent answer, read from storage and kept in sync with it.
 * Unreadable or unwritable storage fails closed: analytics stays off and no
 * prompt shows.
 */
export const createAnalyticsConsent = (
  storage: ConsentStorage,
  warn: (message: string) => void
): AnalyticsConsent => {
  let stored: StoredConsent | undefined;
  let readGeneration = 0;
  const listeners = new Set<() => void>();

  const set = (next: StoredConsent) => {
    const before =
      stored === undefined ? "loading" : analyticsConsentStatusOf(stored);
    stored = next;
    if (analyticsConsentStatusOf(next) === before) return;
    for (const listener of listeners) listener();
  };

  const failClosed = (error: unknown) => {
    warn(`Reading the consent answer failed: ${String(error)}`);
    set(declined);
  };

  const refresh = () => {
    const generation = ++readGeneration;
    const apply = (next: StoredConsent) => {
      if (generation === readGeneration) set(next);
    };
    let result: StoredConsent | Promise<StoredConsent>;
    try {
      result = storage.read();
    } catch (error) {
      failClosed(error);
      return;
    }
    if (result instanceof Promise) {
      result.then(apply, (error: unknown) => {
        if (generation === readGeneration) failClosed(error);
      });
    } else {
      apply(result);
    }
  };

  const choose = (granted: boolean) => {
    // A later read must not overwrite the answer just given.
    const generation = ++readGeneration;
    const answer: StoredConsent = {
      kind: "decided",
      categories: withAnalyticsChoice(stored ?? { kind: "undecided" }, granted),
    };
    const saving = storage.write(answer.categories);
    const failed = (error: unknown) =>
      warn(`Saving the consent answer failed: ${String(error)}`);
    if (!granted) {
      set(answer);
      saving.catch(failed);
      return;
    }
    // Fail closed: a grant applies only once it is saved.
    saving.then(
      () => {
        if (generation === readGeneration) set(answer);
      },
      (error: unknown) => {
        failed(error);
        if (generation === readGeneration) set(declined);
      }
    );
  };

  refresh();
  storage.watch?.(refresh);

  return {
    status: () =>
      stored === undefined ? "loading" : analyticsConsentStatusOf(stored),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    grant: () => choose(true),
    deny: () => choose(false),
    refresh,
  };
};
