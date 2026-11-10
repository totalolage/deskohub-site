import type { AppLocale } from "../i18n/app-locale";

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
      /**
       * When the choice was made, exactly as stored. None when the platform
       * keeps no date the app reads (the web bundle's site cookie) or the
       * record is malformed.
       */
      readonly decidedAt?: string;
      /** The app language the choice was made in; older records hold none. */
      readonly locale?: AppLocale;
    };

/** A consent choice to store, dated and in the language it was made in. */
export interface ConsentChoice {
  readonly categories: readonly ConsentCategory[];
  /** An ISO 8601 instant, stored as given. */
  readonly decidedAt: string;
  readonly locale: AppLocale;
}

/**
 * Who changed the stored answer: the customer here (`local`), the signed-in
 * account (`account`), or a read of storage (`storage`), such as the first
 * one or the site changing the shared cookie.
 */
export type ConsentChange = "local" | "account" | "storage";

/** The account's analytics decision the device takes as its own choice. */
export interface AccountAnalyticsDecision {
  readonly analytics: boolean;
  /** When the account made it, stored exactly as given. */
  readonly decidedAt: string;
}

/**
 * Identifies a stored choice, so a caller can tell whether it changed while
 * something was in flight. Equal for the same answer read again.
 */
export const consentChoiceMark = (
  consent: StoredConsent | undefined
): string => {
  if (consent === undefined) return "loading";
  if (consent.kind === "undecided") return "undecided";
  return `${consent.decidedAt ?? ""} ${consent.categories.join(",")}`;
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
  readonly write: (choice: ConsentChoice) => Promise<void>;
  /**
   * Calls the listener when the answer may have changed outside the app,
   * such as on the site. Returns the unsubscribe function.
   */
  readonly watch?: (listener: () => void) => () => void;
}

export interface AnalyticsConsent {
  readonly status: () => AnalyticsConsentStatus;
  /** The stored answer, or `undefined` while it loads. */
  readonly current: () => StoredConsent | undefined;
  /** Calls the listener when the answer or its date changes. */
  readonly subscribe: (listener: (change: ConsentChange) => void) => () => void;
  readonly grant: () => void;
  readonly deny: () => void;
  /**
   * Takes the account's decision as this device's choice, dated when the
   * account made it, keeping the other categories (none but the necessary
   * ones when there was no choice). Resolves with the answer it stored once
   * it applies: a withdrawal at once, a grant once saved (or the refusal a
   * failed save stores instead).
   */
  readonly applyAccountDecision: (
    decision: AccountAnalyticsDecision
  ) => Promise<StoredConsent>;
  /** Reads the stored answer again. */
  readonly refresh: () => void;
}

/** Where a new choice's date and language come from. */
export interface ConsentChoiceContext {
  readonly now: () => Date;
  /** The language the app shows. */
  readonly locale: () => AppLocale;
}

const declined: StoredConsent = { kind: "decided", categories: ["necessary"] };

/**
 * The analytics consent answer, read from storage and kept in sync with it.
 * Unreadable or unwritable storage fails closed: analytics stays off and no
 * prompt shows.
 */
export const createAnalyticsConsent = (
  storage: ConsentStorage,
  warn: (message: string) => void,
  context: ConsentChoiceContext
): AnalyticsConsent => {
  let stored: StoredConsent | undefined;
  let readGeneration = 0;
  const listeners = new Set<(change: ConsentChange) => void>();

  const set = (next: StoredConsent, change: ConsentChange) => {
    const before = consentChoiceMark(stored);
    stored = next;
    if (consentChoiceMark(next) === before) return;
    for (const listener of listeners) listener(change);
  };

  const failClosed = (error: unknown) => {
    warn(`Reading the consent answer failed: ${String(error)}`);
    set(declined, "storage");
  };

  const refresh = () => {
    const generation = ++readGeneration;
    const apply = (next: StoredConsent) => {
      if (generation === readGeneration) set(next, "storage");
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

  const save = (
    { analytics, decidedAt }: AccountAnalyticsDecision,
    change: Exclude<ConsentChange, "storage">
  ): Promise<StoredConsent> => {
    // A later read must not overwrite the answer just given.
    const generation = ++readGeneration;
    const choice: ConsentChoice = {
      categories: withAnalyticsChoice(
        stored ?? { kind: "undecided" },
        analytics
      ),
      decidedAt,
      locale: context.locale(),
    };
    const answer: StoredConsent = { kind: "decided", ...choice };
    const saving = storage.write(choice);
    const failed = (error: unknown) =>
      warn(`Saving the consent answer failed: ${String(error)}`);
    if (!analytics) {
      set(answer, change);
      return saving.catch(failed).then(() => answer);
    }
    // Fail closed: a grant applies only once it is saved.
    return saving.then(
      () => {
        if (generation === readGeneration) set(answer, change);
        return answer;
      },
      (error: unknown) => {
        failed(error);
        if (generation === readGeneration) set(declined, change);
        return declined;
      }
    );
  };

  const choose = (analytics: boolean) =>
    void save({ analytics, decidedAt: context.now().toISOString() }, "local");

  refresh();
  storage.watch?.(refresh);

  return {
    status: () =>
      stored === undefined ? "loading" : analyticsConsentStatusOf(stored),
    current: () => stored,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    grant: () => choose(true),
    deny: () => choose(false),
    applyAccountDecision: (decision) => save(decision, "account"),
    refresh,
  };
};
