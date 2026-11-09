import { Schema } from "effect";
import { type Locale, m } from "@/features/i18n";

/**
 * The account's sections in navigation order. Each opens at its own path,
 * `/[locale]/account/<section>`; Legal & Privacy is the public
 * `/account/legal` page, so it works for anonymous visitors too.
 */
export const accountSections = [
  "reservations",
  "referrals",
  "profile",
  "security",
  "assistants",
  "billing",
  "legal",
  "danger",
] as const;
const accountSectionSchema = Schema.Literals(accountSections);
export type AccountSection = typeof accountSectionSchema.Type;

/** The section the bare `/[locale]/account` shows. */
export const defaultAccountSection: AccountSection = "reservations";

export const isAccountSection = Schema.is(accountSectionSchema);

/**
 * A section's name as the navigation, the account shell and the page title
 * show it.
 */
export const accountSectionLabel = (section: AccountSection, locale: Locale) =>
  ({
    reservations: m.accountSectionReservations,
    referrals: m.accountSectionReferrals,
    profile: m.accountSectionProfile,
    security: m.accountSectionSecurity,
    assistants: m.accountSectionAssistants,
    billing: m.accountSectionBilling,
    legal: m.accountSectionLegal,
    danger: m.accountSectionDanger,
  })[section]({}, { locale });

/**
 * A section the signed-in account page renders at `/account/<section>`.
 * Legal & Privacy has its own public page.
 */
export type AccountPageSection = Exclude<AccountSection, "legal">;

export const isAccountPageSection = (
  value: string
): value is AccountPageSection => isAccountSection(value) && value !== "legal";

export type AccountSectionRelease = {
  readonly passkeysEnabled: boolean;
  readonly referralsEnabled: boolean;
};

/** Sections withheld until their release flag is on. */
export const flagGatedAccountSections = ["referrals", "security"] as const;

/** Whether a flag-gated section is released; other sections always are. */
export const isAccountSectionReleased = (
  section: AccountSection,
  { passkeysEnabled, referralsEnabled }: AccountSectionRelease
) => {
  if (section === "referrals") return referralsEnabled;
  if (section === "security") return passkeysEnabled;
  return true;
};
