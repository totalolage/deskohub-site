import type { ConsentCategory } from "../config/consent-config";

const consentCookieName = "cc_cookie=";
const consentCategories = new Set<string>([
  "necessary",
  "analytics",
  "marketing",
  "preferences",
]);

export function getAcceptedConsentCategoriesFromCookie(cookieString: string) {
  const consentCookie = cookieString
    .split("; ")
    .find((cookie) => cookie.startsWith(consentCookieName));

  if (!consentCookie) return [];

  try {
    const value = JSON.parse(
      decodeURIComponent(consentCookie.slice(consentCookieName.length))
    );
    if (typeof value !== "object" || value === null) return [];

    const { categories } = value as { categories?: unknown };
    if (!Array.isArray(categories)) return [];

    return categories.filter(
      (category): category is ConsentCategory =>
        typeof category === "string" && consentCategories.has(category)
    );
  } catch {
    return [];
  }
}
