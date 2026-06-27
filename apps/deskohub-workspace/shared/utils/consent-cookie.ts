export const CONSENT_COOKIE_NAME = "cc_cookie";

const consentCategories = new Set<string>([
  "necessary",
  "analytics",
  "marketing",
  "preferences",
]);

export type ConsentCategory =
  | "necessary"
  | "analytics"
  | "marketing"
  | "preferences";

export function getAcceptedConsentCategoriesFromCookie(cookieString: string) {
  const cookieValue = getConsentCookieValuesFromCookie(cookieString)[0];

  return getAcceptedConsentCategoriesFromCookieValue(cookieValue);
}

export function getConsentCookieValuesFromCookie(cookieString: string) {
  return new URLSearchParams(cookieString.replace(/;\s*/g, "&")).getAll(
    CONSENT_COOKIE_NAME
  );
}

export function getAcceptedConsentCategoriesFromCookieValue(
  cookieValue: string | null | undefined
) {
  if (!cookieValue) return [];

  const value = parseConsentCookieValue(cookieValue);
  if (typeof value !== "object" || value === null) return [];

  const { categories } = value as { categories?: unknown };
  if (!Array.isArray(categories)) return [];

  return categories.filter(
    (category): category is ConsentCategory =>
      typeof category === "string" && consentCategories.has(category)
  );
}

function parseConsentCookieValue(cookieValue: string) {
  try {
    return JSON.parse(cookieValue) as unknown;
  } catch {
    try {
      return JSON.parse(decodeURIComponent(cookieValue)) as unknown;
    } catch {
      return undefined;
    }
  }
}
