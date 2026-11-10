import { CustomerAnalyticsChoice } from "@deskohub/workspace-customer-api";
import { Predicate, Schema } from "effect";
import { isAppLocale } from "../i18n/app-locale";
import {
  type ConsentChoice,
  isConsentCategory,
  type StoredConsent,
} from "./analytics-consent";

/** The native storage key holding the consent answer. */
export const consentRecordKey = "deskohub:consent";

const declined: StoredConsent = { kind: "decided", categories: [] };

/**
 * An instant the account sync accepts as a choice's decision time, the
 * customer API's own rule.
 */
const isDecisionTime = Schema.is(CustomerAnalyticsChoice.fields.decidedAt);

/**
 * Reads the stored native consent record. A missing record is no answer; a
 * malformed one, including one with an unknown category or without a valid
 * decision time, reads as declined, like a malformed site cookie. The
 * decision time is kept exactly as stored, since an account decision stored
 * here must be sent back unchanged; the language is kept when it is one the
 * app supports (records before it was stored have none).
 */
export const parseConsentRecord = (raw: string | null): StoredConsent => {
  if (raw === null) return { kind: "undecided" };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return declined;
  }
  if (!Predicate.isReadonlyObject(value)) return declined;
  const { categories, decidedAt, locale } = value;
  if (
    !Array.isArray(categories) ||
    !categories.every(isConsentCategory) ||
    !isDecisionTime(decidedAt)
  ) {
    return declined;
  }
  return {
    kind: "decided",
    categories,
    decidedAt,
    ...(isAppLocale(locale) ? { locale } : {}),
  };
};

export const serializeConsentRecord = ({
  categories,
  decidedAt,
  locale,
}: ConsentChoice): string => JSON.stringify({ categories, decidedAt, locale });
