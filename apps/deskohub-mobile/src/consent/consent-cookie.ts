import {
  type ConsentCategory,
  consentCategories,
  isConsentCategory,
  type StoredConsent,
} from "./analytics-consent";

/**
 * The site's consent cookie. The web app shares its origin, so this cookie is
 * the one consent answer for both; the site's banner (vanilla-cookieconsent
 * 3.1.0) reads what the app writes.
 */
export const consentCookieName = "cc_cookie";

/** vanilla-cookieconsent's default lifetime, which the site keeps. */
const consentLifetimeDays = 182;

const cookieValues = (cookieString: string): string[] =>
  new URLSearchParams(cookieString.replace(/;\s*/g, "&")).getAll(
    consentCookieName
  );

const parseCookieJson = (cookieValue: string): unknown => {
  try {
    return JSON.parse(cookieValue);
  } catch {
    try {
      return JSON.parse(decodeURIComponent(cookieValue));
    } catch {
      return undefined;
    }
  }
};

/** A copy's accepted categories, or `null` when the copy is malformed. */
const copyCategories = (cookieValue: string): ConsentCategory[] | null => {
  // An emptied copy accepts nothing without being malformed.
  if (cookieValue === "") return [];
  const value = parseCookieJson(cookieValue);
  if (typeof value !== "object" || value === null) return null;
  const { categories } = value as { readonly categories?: unknown };
  if (!Array.isArray(categories)) return null;
  return categories.every(isConsentCategory) ? categories : null;
};

/**
 * Reads the consent answer from `document.cookie` the way the site's
 * `getAcceptedConsentCategoriesFromCookie` does: the categories every copy
 * accepts, and none when any copy is malformed. No cookie is no answer.
 */
export const readConsentCookie = (cookieString: string): StoredConsent => {
  const values = cookieValues(cookieString);
  if (values.length === 0) return { kind: "undecided" };
  const copies = values.map(copyCategories);
  if (copies.some((copy) => copy === null)) {
    return { kind: "decided", categories: [] };
  }
  return {
    kind: "decided",
    categories: consentCategories.filter((category) =>
      copies.every((copy) => copy?.includes(category))
    ),
  };
};

/** The cookie's earlier record, kept so the site sees the same consent. */
const earlierRecord = (
  cookieString: string
): Readonly<Record<string, unknown>> | undefined => {
  const [value, ...others] = cookieValues(cookieString);
  if (value === undefined || others.length > 0) return undefined;
  const parsed = parseCookieJson(value);
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Readonly<Record<string, unknown>>)
    : undefined;
};

const nonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value !== "";

/**
 * The `document.cookie` assignment that saves a consent answer in
 * vanilla-cookieconsent's format. It keeps the earlier record's consent ID,
 * first-consent time, revision and other fields, dates the save at
 * `decidedAt` (an account decision keeps the account's instant, as the
 * site's own copy does), and writes the cookie with the library's attributes
 * so it replaces the site's copy.
 */
export const consentCookieAssignment = ({
  cookieString,
  categories,
  now,
  decidedAt,
  hostname,
  secure,
  languageCode,
  createConsentId,
}: {
  readonly cookieString: string;
  readonly categories: readonly ConsentCategory[];
  readonly now: Date;
  /** When the choice was made, as an ISO 8601 instant. */
  readonly decidedAt: string;
  readonly hostname: string;
  readonly secure: boolean;
  readonly languageCode: string;
  readonly createConsentId: () => string;
}): string => {
  const earlier = earlierRecord(cookieString);
  const expires = new Date(
    now.getTime() + consentLifetimeDays * 24 * 60 * 60 * 1000
  );
  const record = {
    revision: 0,
    data: null,
    services: {},
    languageCode,
    ...earlier,
    categories,
    consentId: nonEmptyString(earlier?.consentId)
      ? earlier.consentId
      : createConsentId(),
    consentTimestamp: nonEmptyString(earlier?.consentTimestamp)
      ? earlier.consentTimestamp
      : now.toISOString(),
    lastConsentTimestamp: decidedAt,
    expirationTime: expires.getTime(),
  };
  const attributes = [
    `expires=${expires.toUTCString()}`,
    "Path=/",
    "SameSite=Lax",
    ...(hostname.includes(".") ? [`Domain=${hostname}`] : []),
    ...(secure ? ["Secure"] : []),
  ];
  return [
    `${consentCookieName}=${encodeURIComponent(JSON.stringify(record))}`,
    ...attributes,
  ].join("; ");
};
