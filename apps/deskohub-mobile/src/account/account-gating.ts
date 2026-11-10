import type {
  CustomerAccountState,
  CustomerOrderState,
  CustomerReservationSummary,
} from "@deskohub/workspace-customer-api";
import { Match } from "effect";
import type { Href } from "expo-router";

/**
 * The Account tab's sections, in the site's navigation order (reservations
 * has its own tab). `complete` takes the profile's place until the profile
 * exists.
 */
export const accountSectionOrder = [
  "referrals",
  "complete",
  "profile",
  "language",
  "security",
  "assistants",
  "billing",
  "legal",
  "danger",
] as const;
export type AccountSection = (typeof accountSectionOrder)[number];

/** Where each section's row on the Account tab leads. */
export const accountSectionHref = {
  referrals: "/account/referrals",
  complete: "/account/complete",
  profile: "/account/profile",
  language: "/account/language",
  security: "/account/security",
  assistants: "/account/assistants",
  billing: "/account/billing",
  legal: "/account/legal",
  danger: "/account/danger",
} as const satisfies Record<AccountSection, Href>;

/** Why the account can't show its profile and reservations, if it can't. */
export type AccountNotice =
  | "completion-required"
  | "support-required"
  | "unavailable"
  | "deletion-pending";

const noticeOf = (account: CustomerAccountState): AccountNotice | undefined =>
  Match.value(account).pipe(
    Match.discriminatorsExhaustive("kind")({
      linked: () => undefined,
      "review-account": () => undefined,
      "completion-required": () => "completion-required" as const,
      "support-required": () => "support-required" as const,
      "authenticated-unavailable": () => "unavailable" as const,
      "deletion-pending": () => "deletion-pending" as const,
    })
  );

const sectionAvailable: Record<
  AccountSection,
  (account: CustomerAccountState) => boolean
> = {
  referrals: (account) => account.kind === "linked" && account.referralsEnabled,
  complete: (account) => account.kind === "completion-required",
  profile: (account) => account.kind === "linked",
  // The language is a sign-in setting, not profile data; the API refuses it
  // only while deletion is pending.
  language: (account) => account.kind !== "deletion-pending",
  billing: (account) => account.kind === "linked",
  // Sign-in methods and assistants need only the session; the API leaves
  // them out while the release withholds passkeys or deletion is pending.
  security: (account) => account.passkeys !== undefined,
  assistants: (account) => account.assistants !== undefined,
  legal: () => true,
  danger: (account) =>
    account.kind !== "review-account" && account.deletion !== "withheld",
};

export interface AccountIndexModel {
  readonly sections: ReadonlyArray<AccountSection>;
  readonly notice: AccountNotice | undefined;
  /** Whether the danger zone shows a pending deletion to retry. */
  readonly deletionPending: boolean;
}

/** What the Account tab's index shows for a GET /account result. */
export const accountIndexModel = (
  account: CustomerAccountState
): AccountIndexModel => ({
  sections: accountSectionOrder.filter((section) =>
    sectionAvailable[section](account)
  ),
  notice: noticeOf(account),
  deletionPending: account.deletion === "pending",
});

/** What the Reservations tab may show for the account. */
export type ReservationsAccess =
  | { readonly kind: "available" }
  /** The tab asks for the profile first and links to `account/complete`. */
  | { readonly kind: "completion-required" }
  | { readonly kind: "unavailable"; readonly notice: AccountNotice };

export const reservationsAccess = (
  account: CustomerAccountState
): ReservationsAccess =>
  Match.value(account).pipe(
    Match.discriminatorsExhaustive("kind")({
      linked: () => ({ kind: "available" }) as const,
      // A review account shows its sample reservations.
      "review-account": () => ({ kind: "available" }) as const,
      "completion-required": () => ({ kind: "completion-required" }) as const,
      "support-required": () =>
        ({ kind: "unavailable", notice: "support-required" }) as const,
      "authenticated-unavailable": () =>
        ({ kind: "unavailable", notice: "unavailable" }) as const,
      "deletion-pending": () =>
        ({ kind: "unavailable", notice: "deletion-pending" }) as const,
    })
  );

/** A history row opens its status screen only when it names an order. */
export const opensReservationStatus = (
  reservation: Pick<CustomerReservationSummary, "orderId">
) => reservation.orderId !== undefined;

/** A review-sandbox order never links to an access code. */
export const offersAccessCode = (
  order: Pick<CustomerOrderState, "reviewSandbox">
) => order.reviewSandbox !== true;
