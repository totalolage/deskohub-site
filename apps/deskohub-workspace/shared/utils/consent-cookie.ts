import { Option, Predicate, Result } from "effect";
import { parseInstant } from "./temporal";

export const CONSENT_COOKIE_NAME = "cc_cookie";

/** Every consent category the visitor can accept, in display order. */
export const consentCategories = [
  "necessary",
  "analytics",
  "marketing",
  "preferences",
] as const;
const isConsentCategory = <T>(value: T): value is T & ConsentCategory =>
  Predicate.isString(value) && consentCategories.includes(value);
export type ConsentCategory = (typeof consentCategories)[number];

export type UnexpectedConsentCookieReason =
  | "invalid_json"
  | "invalid_value_type"
  | "invalid_categories_type"
  | "invalid_category_type"
  | "unknown_category";

type ConsentCookieDiagnostics = {
  readonly onUnexpectedValue?: (reason: UnexpectedConsentCookieReason) => void;
};

/** How to read the consent cookie. */
export type ConsentCookieReading = ConsentCookieDiagnostics & {
  /**
   * The banner's current revision. A copy saved under another revision, or
   * under none, holds no choice: the banner asks again, as
   * vanilla-cookieconsent does when the cookie's revision differs from its
   * configured one.
   */
  readonly revision: number;
};

export function getConsentCookieValuesFromCookie(cookieString: string) {
  return new URLSearchParams(cookieString.replace(/;\s*/g, "&")).getAll(
    CONSENT_COOKIE_NAME
  );
}

/**
 * The choice the device saved in the consent banner: the categories it
 * accepts and when it last saved them.
 */
/**
 * `instant` as the consent cookie's last-consent timestamp holds it: ISO 8601
 * truncated to the millisecond, so a device's copy of an account decision is
 * never newer than the decision it copies.
 */
export const toConsentCookieTimestamp = (instant: Temporal.Instant): string =>
  instant
    .round({ smallestUnit: "millisecond", roundingMode: "trunc" })
    .toString();

export interface ConsentCookieChoice {
  readonly acceptedCategories: readonly ConsentCategory[];
  /**
   * The cookie's own `lastConsentTimestamp`, which the banner sets on every
   * save. None when a copy holds no valid timestamp.
   */
  readonly lastConsentAt: Option.Option<Temporal.Instant>;
  /**
   * The cookie's own `languageCode`: the banner language of the last save.
   * None when a copy holds none or copies disagree.
   */
  readonly languageCode: Option.Option<string>;
}

/**
 * The device's saved choice. None without a consent cookie, when a copy is
 * emptied or saved under another banner revision, or when any copy is
 * malformed, so only a well-formed save under the current revision counts as
 * a choice. Several copies read as the categories every copy accepts,
 * dated at the oldest save, and as undated when any copy is. Every copy is
 * read, so diagnostics see each unexpected value.
 */
export function readConsentCookieChoice(
  cookieString: string,
  reading: ConsentCookieReading
): Option.Option<ConsentCookieChoice> {
  const consentCookieValues = getConsentCookieValuesFromCookie(cookieString);
  if (consentCookieValues.length === 0) return Option.none();

  let hasUnexpectedValue = false;
  const copies = consentCookieValues.map((cookieValue) =>
    readConsentCookieCopy(cookieValue, {
      revision: reading.revision,
      onUnexpectedValue: (reason) => {
        hasUnexpectedValue = true;
        reading.onUnexpectedValue?.(reason);
      },
    })
  );
  if (hasUnexpectedValue) return Option.none();

  return Option.map(Option.all(copies), (savedCopies) => ({
    acceptedCategories: consentCategories.filter((category) =>
      savedCopies.every((copy) => copy.acceptedCategories.includes(category))
    ),
    lastConsentAt: Option.map(
      Option.all(savedCopies.map((copy) => copy.lastConsentAt)),
      (instants) =>
        instants.reduce((oldest, instant) =>
          Temporal.Instant.compare(instant, oldest) < 0 ? instant : oldest
        )
    ),
    languageCode: Option.flatMap(
      Option.all(savedCopies.map((copy) => copy.languageCode)),
      ([first, ...others]) =>
        others.every((code) => code === first)
          ? Option.fromUndefinedOr(first)
          : Option.none()
    ),
  }));
}

/**
 * The categories every copy of the consent cookie accepts. Empty without a
 * choice under the current revision or when any copy is malformed, so an
 * unexpected value reads as declined. Every copy is read, so diagnostics see
 * each unexpected value.
 */
export function getAcceptedConsentCategoriesFromCookie(
  cookieString: string,
  reading: ConsentCookieReading
): ConsentCategory[] {
  return Option.match(readConsentCookieChoice(cookieString, reading), {
    onNone: () => [],
    onSome: (choice) => [...choice.acceptedCategories],
  });
}

/**
 * True only when the browser holds a consent cookie and every copy of it is
 * well-formed, saved under the current revision, and accepts the category. A
 * malformed or earlier-revision copy reads as declined.
 */
export function isConsentCategoryAcceptedInCookie(
  cookieString: string,
  category: ConsentCategory,
  reading: ConsentCookieReading
): boolean {
  return getAcceptedConsentCategoriesFromCookie(cookieString, reading).includes(
    category
  );
}

/**
 * One copy's saved choice. None for an emptied copy or one saved under
 * another revision, which accept nothing without being unexpected, and for a
 * malformed one, which it reports.
 */
function readConsentCookieCopy(
  cookieValue: string,
  reading: ConsentCookieReading
): Option.Option<ConsentCookieChoice> {
  if (!cookieValue) return Option.none();
  const reportUnexpectedValue = (reason: UnexpectedConsentCookieReason) =>
    reading.onUnexpectedValue?.(reason);

  const savedValue = readSavedConsentCookieValue(cookieValue);
  if (Result.isFailure(savedValue)) {
    reportUnexpectedValue(savedValue.failure);
    return Option.none();
  }
  if (savedValue.success.revision !== reading.revision) return Option.none();

  const acceptedCategories: ConsentCategory[] = [];
  let hasUnexpectedCategory = false;

  for (const category of savedValue.success.categories) {
    if (!Predicate.isString(category)) {
      hasUnexpectedCategory = true;
      reportUnexpectedValue("invalid_category_type");
      continue;
    }
    if (!isConsentCategory(category)) {
      hasUnexpectedCategory = true;
      reportUnexpectedValue("unknown_category");
      continue;
    }

    acceptedCategories.push(category);
  }
  if (hasUnexpectedCategory) return Option.none();

  const { lastConsentTimestamp, languageCode } = savedValue.success;
  return Option.some({
    acceptedCategories,
    lastConsentAt: Predicate.isString(lastConsentTimestamp)
      ? parseInstant(lastConsentTimestamp)
      : Option.none(),
    languageCode: Predicate.isString(languageCode)
      ? Option.some(languageCode)
      : Option.none(),
  });
}

/**
 * The categories list, revision, last-consent timestamp, and language a
 * consent cookie value holds, or why it holds no categories list.
 */
const readSavedConsentCookieValue = (
  cookieValue: string
): Result.Result<
  {
    readonly categories: readonly unknown[];
    readonly revision: unknown;
    readonly lastConsentTimestamp: unknown;
    readonly languageCode: unknown;
  },
  UnexpectedConsentCookieReason
> => {
  const parsedValue = parseConsentCookieValue(cookieValue);
  if (Option.isNone(parsedValue)) return Result.fail("invalid_json");
  const value = parsedValue.value;
  if (!Predicate.isObject(value)) return Result.fail("invalid_value_type");

  const { categories, revision, lastConsentTimestamp, languageCode } =
    value as {
      categories?: unknown;
      revision?: unknown;
      lastConsentTimestamp?: unknown;
      languageCode?: unknown;
    };
  return Array.isArray(categories)
    ? Result.succeed({
        categories,
        revision,
        lastConsentTimestamp,
        languageCode,
      })
    : Result.fail("invalid_categories_type");
};

const parseJsonCookieValue = Option.liftThrowable(
  (cookieValue: string): unknown => JSON.parse(cookieValue)
);

const parseUriEncodedJsonCookieValue = Option.liftThrowable(
  (cookieValue: string): unknown => JSON.parse(decodeURIComponent(cookieValue))
);

const parseConsentCookieValue = (cookieValue: string) =>
  parseJsonCookieValue(cookieValue).pipe(
    Option.orElse(() => parseUriEncodedJsonCookieValue(cookieValue))
  );
