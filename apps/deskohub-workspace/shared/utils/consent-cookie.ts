export const CONSENT_COOKIE_NAME = "cc_cookie";

const consentCategories = [
  "necessary",
  "analytics",
  "marketing",
  "preferences",
] as const;
export const isConsentCategory = (value: unknown): value is ConsentCategory =>
  typeof value === "string" && consentCategories.includes(value);
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

export function getAcceptedConsentCategoriesFromCookieValue(
  cookieValue: string | null | undefined,
  diagnostics?: ConsentCookieDiagnostics
) {
  if (!cookieValue) return [];

  const value = parseConsentCookieValue(cookieValue);
  if (value === undefined) {
    diagnostics?.onUnexpectedValue?.("invalid_json");
    return [];
  }
  if (typeof value !== "object" || value === null) {
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
    if (typeof category !== "string") {
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
