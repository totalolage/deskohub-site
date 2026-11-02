export const CONSENT_COOKIE_NAME = "cc_cookie";

const consentCategories = [
  "necessary",
  "analytics",
  "marketing",
  "preferences",
] as const;
export const isConsentCategory = <T>(value: T): value is T & ConsentCategory =>
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

export function getAcceptedConsentCategoriesFromCookie(
  cookieString: string,
  diagnostics?: ConsentCookieDiagnostics
) {
  const cookieValue = getConsentCookieValuesFromCookie(cookieString)[0];

  return getAcceptedConsentCategoriesFromCookieValue(cookieValue, diagnostics);
}

export function getConsentCookieValuesFromCookie(cookieString: string) {
  return new URLSearchParams(cookieString.replace(/;\s*/g, "&")).getAll(
    CONSENT_COOKIE_NAME
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
  const consentCookieValues = getConsentCookieValuesFromCookie(cookieString);
  if (consentCookieValues.length === 0) return false;

  // Every copy is read, so diagnostics see each unexpected value.
  const copiesAccepting = consentCookieValues.map((cookieValue) => {
    let hasUnexpectedValue = false;
    const acceptedCategories = getAcceptedConsentCategoriesFromCookieValue(
      cookieValue,
      {
        onUnexpectedValue: (reason) => {
          hasUnexpectedValue = true;
          diagnostics?.onUnexpectedValue?.(reason);
        },
      }
    );

    return !hasUnexpectedValue && acceptedCategories.includes(category);
  });
  return copiesAccepting.every(Boolean);
}

export function getAcceptedConsentCategoriesFromCookieValue(
  cookieValue: string | null | undefined,
  diagnostics?: ConsentCookieDiagnostics
) {
  if (!cookieValue) return [];

  const parsedValue = parseConsentCookieValue(cookieValue);
  if (Option.isNone(parsedValue)) {
    diagnostics?.onUnexpectedValue?.("invalid_json");
    return [];
  }
  const value = parsedValue.value;
  if (!Predicate.isObject(value)) {
    diagnostics?.onUnexpectedValue?.("invalid_value_type");
    return [];
  }

  const { categories } = value as { categories?: unknown };
  if (!Array.isArray(categories)) {
    diagnostics?.onUnexpectedValue?.("invalid_categories_type");
    return [];
  }

  const acceptedCategories: ConsentCategory[] = [];

  for (const category of categories) {
    if (!Predicate.isString(category)) {
      diagnostics?.onUnexpectedValue?.("invalid_category_type");
      continue;
    }
    if (!isConsentCategory(category)) {
      diagnostics?.onUnexpectedValue?.("unknown_category");
      continue;
    }

    acceptedCategories.push(category);
  }

  return acceptedCategories;
}

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

import { Option, Predicate } from "effect";
