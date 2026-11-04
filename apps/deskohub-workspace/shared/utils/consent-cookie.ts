import { Option, Predicate, Result } from "effect";

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

export function getConsentCookieValuesFromCookie(cookieString: string) {
  return new URLSearchParams(cookieString.replace(/;\s*/g, "&")).getAll(
    CONSENT_COOKIE_NAME
  );
}

/**
 * The categories every copy of the consent cookie accepts. Empty without a
 * consent cookie or when any copy is malformed, so an unexpected value reads
 * as declined. Every copy is read, so diagnostics see each unexpected value.
 */
export function getAcceptedConsentCategoriesFromCookie(
  cookieString: string,
  diagnostics?: ConsentCookieDiagnostics
): ConsentCategory[] {
  const consentCookieValues = getConsentCookieValuesFromCookie(cookieString);
  if (consentCookieValues.length === 0) return [];

  let hasUnexpectedValue = false;
  const acceptedByCopy = consentCookieValues.map((cookieValue) =>
    getAcceptedConsentCategoriesFromCookieValue(cookieValue, {
      onUnexpectedValue: (reason) => {
        hasUnexpectedValue = true;
        diagnostics?.onUnexpectedValue?.(reason);
      },
    })
  );
  if (hasUnexpectedValue) return [];

  return consentCategories.filter((category) =>
    acceptedByCopy.every((accepted) => accepted.includes(category))
  );
}

/**
 * True only when the browser holds a consent cookie and every copy of it is
 * well-formed and accepts the category. A malformed copy reads as declined.
 */
export function isConsentCategoryAcceptedInCookie(
  cookieString: string,
  category: ConsentCategory,
  diagnostics?: ConsentCookieDiagnostics
): boolean {
  return getAcceptedConsentCategoriesFromCookie(
    cookieString,
    diagnostics
  ).includes(category);
}

function getAcceptedConsentCategoriesFromCookieValue(
  cookieValue: string,
  diagnostics: ConsentCookieDiagnostics
): ConsentCategory[] {
  // An emptied copy accepts nothing without being unexpected.
  if (!cookieValue) return [];
  const reportUnexpectedValue = (reason: UnexpectedConsentCookieReason) =>
    diagnostics.onUnexpectedValue?.(reason);

  const categories = readConsentCookieCategories(cookieValue);
  if (Result.isFailure(categories)) {
    reportUnexpectedValue(categories.failure);
    return [];
  }

  const acceptedCategories: ConsentCategory[] = [];

  for (const category of categories.success) {
    if (!Predicate.isString(category)) {
      reportUnexpectedValue("invalid_category_type");
      continue;
    }
    if (!isConsentCategory(category)) {
      reportUnexpectedValue("unknown_category");
      continue;
    }

    acceptedCategories.push(category);
  }

  return acceptedCategories;
}

/** The categories list a consent cookie value holds, or why it holds none. */
const readConsentCookieCategories = (
  cookieValue: string
): Result.Result<readonly unknown[], UnexpectedConsentCookieReason> => {
  const parsedValue = parseConsentCookieValue(cookieValue);
  if (Option.isNone(parsedValue)) return Result.fail("invalid_json");
  const value = parsedValue.value;
  if (!Predicate.isObject(value)) return Result.fail("invalid_value_type");

  const { categories } = value as { categories?: unknown };
  return Array.isArray(categories)
    ? Result.succeed(categories)
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
