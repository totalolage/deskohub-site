"use client";

import Interpolate from "@doist/react-interpolate";
import Link from "next/link";
import { type ReactNode, useEffect } from "react";
import { useAccountLayout } from "@/features/account/components/account-layout-shell";
import { CustomerAgentConnectionsSection } from "@/features/account/components/customer-agent-connections/customer-agent-connections-section";
import { DeleteAccountCard } from "@/features/account/components/delete-account-card";
import { SignInSecuritySection } from "@/features/account/components/passkeys/sign-in-security-section";
import {
  type AccountPasskeys,
  useAccountPasskeys,
} from "@/features/account/components/passkeys/use-account-passkeys";
import { ProfileCompletionReferralNotice } from "@/features/account/components/profile-completion-referral-notice";
import { ProfileForm } from "@/features/account/components/profile-form";
import { ReferralScreen } from "@/features/account/components/referral-screen";
import type { CustomerReservationHistory } from "@/features/account/contracts";
import type { CustomerAccountPageState } from "@/features/account/page-data.server";
import { accountSectionLabel } from "@/features/account/sections";
import { type Locale, m } from "@/features/i18n";
import {
  formatReferralDiscount,
  formatReferralDiscountReduction,
} from "@/features/referrals/client";
import type { ReferralAccountOverview } from "@/features/referrals/contracts";
import { ForgetRememberedReferralCode } from "@/features/referrals/forget-remembered-referral-code";
import { ReviewAccountCard } from "@/features/review-accounts/components/review-account-card";
import { Card, CardContent } from "@/shared/components/ui/card";

type RenderedReservations = {
  /** The current reservations the navigation counts; unknown while unavailable. */
  readonly count: number | undefined;
  /** The Reservations section, rendered on the server. */
  readonly history: ReactNode;
};

/**
 * Replaces a state's reservation history with its rendering, required or
 * optional as the history is.
 */
type WithRenderedReservations<State> = State extends {
  readonly history: CustomerReservationHistory;
}
  ? Omit<State, "history"> & { readonly reservations: RenderedReservations }
  : State extends { readonly history?: CustomerReservationHistory }
    ? Omit<State, "history"> & { readonly reservations?: RenderedReservations }
    : State;

/**
 * A signed-in account page state as the client receives it. The page renders
 * the reservation history on the server and passes in the rendering instead:
 * its dates come from `Intl`, whose spacing differs between Node and
 * browsers, so formatting them again in the client tree would not match the
 * server HTML.
 */
export type SignedInAccountState = WithRenderedReservations<
  Exclude<
    CustomerAccountPageState,
    { readonly kind: "unauthenticated" | "unavailable" }
  >
>;

type SignedInAccountProps = {
  readonly locale: Locale;
  readonly state: SignedInAccountState;
};

/**
 * Every section of a signed-in account's page, shown by state: a linked
 * account gives each section its own panel; without a usable profile, a card
 * explaining why, with the Reservations it authored and account deletion,
 * fills every section but those that need only the session, Sign-in &
 * security and Connected assistants. Switching sections only hides panels, so
 * drafts and open dialogs survive.
 *
 * The view publishes the navigation's reservation count and, for a linked
 * account, its referral badge, and shares one passkey list between the
 * post-sign-in prompt, Sign-in & security, and deletion. Deletion shows only
 * when the state offers it or it is pending: never for a review account, nor
 * while that can't be ruled out.
 */
export function SignedInAccount(props: SignedInAccountProps) {
  // A linked account and one without a profile share no panels, so a refresh
  // that moves between them starts the new layout afresh, its passkey list
  // included.
  return (
    <SignedInAccountSections
      key={props.state.kind === "linked" ? "linked" : "without-profile"}
      {...props}
    />
  );
}

type LinkedAccountState = Extract<
  SignedInAccountState,
  { readonly kind: "linked" }
>;

type AccountWithoutProfileState = Exclude<
  SignedInAccountState,
  { readonly kind: "linked" }
>;

/**
 * Publishes the account's reservation count and, while the referral program
 * is released, its earned discount to the account navigation.
 */
function usePublishedAccountNavigation(
  state: SignedInAccountState,
  locale: Locale
) {
  const { setReferralBadge, setReservationCount } = useAccountLayout();
  const reservationCount =
    "reservations" in state ? state.reservations?.count : undefined;
  const referralBadge =
    state.kind === "linked" && state.referralsEnabled
      ? referralNavigationBadge(state.referrals, locale)
      : undefined;
  const referralBadgeText = referralBadge?.text;
  const referralBadgeLabel = referralBadge?.label;

  useEffect(() => {
    setReservationCount(reservationCount);
    return () => setReservationCount(undefined);
  }, [reservationCount, setReservationCount]);

  // Depend on the strings, not a badge object, so publishing it cannot loop.
  useEffect(() => {
    setReferralBadge(
      referralBadgeText === undefined || referralBadgeLabel === undefined
        ? undefined
        : { text: referralBadgeText, label: referralBadgeLabel }
    );
    return () => setReferralBadge(undefined);
  }, [referralBadgeLabel, referralBadgeText, setReferralBadge]);
}

function SignedInAccountSections({ locale, state }: SignedInAccountProps) {
  const { activeSection } = useAccountLayout();
  const accountPasskeys = useAccountPasskeys(state.passkeys);
  usePublishedAccountNavigation(state, locale);

  // A pending deletion only confirms the deletion.
  const signInSecurity =
    state.deletion === "pending" ? undefined : accountPasskeys;

  return (
    <>
      {state.kind === "linked" ? (
        <LinkedAccountPanels locale={locale} state={state} />
      ) : (
        <AccountWithoutProfilePanels
          accountPasskeys={accountPasskeys}
          locale={locale}
          sessionSectionActive={isSessionSectionActive(
            activeSection,
            signInSecurity !== undefined,
            state.assistants !== undefined
          )}
          state={state}
        />
      )}

      {signInSecurity && (
        <SignInSecuritySection
          accountPasskeys={signInSecurity}
          email={state.email}
          hidden={activeSection !== "security"}
          locale={locale}
        />
      )}

      {state.assistants !== undefined && (
        <CustomerAgentConnectionsSection
          connections={state.assistants}
          hidden={activeSection !== "assistants"}
          locale={locale}
        />
      )}

      {state.kind === "linked" && (
        <div hidden={activeSection !== "danger"}>
          <AccountDeletion
            accountPasskeys={accountPasskeys}
            heading={accountSectionLabel("danger", locale)}
            locale={locale}
            state={state}
          />
        </div>
      )}
    </>
  );
}

/** Whether a session section the account has, security or assistants, is open. */
const isSessionSectionActive = (
  activeSection: ReturnType<typeof useAccountLayout>["activeSection"],
  hasSignInSecurity: boolean,
  hasAssistants: boolean
) =>
  (hasSignInSecurity && activeSection === "security") ||
  (hasAssistants && activeSection === "assistants");

/** The account deletion card, unless deletion is withheld. */
function AccountDeletion({
  accountPasskeys,
  heading,
  locale,
  state,
}: {
  readonly accountPasskeys: AccountPasskeys | undefined;
  readonly heading?: string;
  readonly locale: Locale;
  readonly state: SignedInAccountState;
}) {
  if (state.deletion === "withheld") return null;

  return (
    <DeleteAccountCard
      deletionPending={state.deletion === "pending"}
      email={state.email}
      heading={heading}
      locale={locale}
      passkeys={accountPasskeys}
    />
  );
}

/** A linked account's reservations, referrals, and profile. */
function LinkedAccountPanels({
  locale,
  state,
}: {
  readonly locale: Locale;
  readonly state: LinkedAccountState;
}) {
  const { activeSection, changeSection } = useAccountLayout();

  return (
    <>
      {state.rememberedReferralCodeUsed && <ForgetRememberedReferralCode />}
      {state.referralsEnabled && (
        <ProfileCompletionReferralNotice
          locale={locale}
          outcome={state.signupReferral}
        />
      )}
      <div hidden={activeSection !== "reservations"}>
        {state.reservations.history}
      </div>
      {state.referralsEnabled && (
        <div hidden={activeSection !== "referrals"}>
          <ReferralScreen locale={locale} referrals={state.referrals} />
        </div>
      )}
      <div hidden={activeSection !== "profile" && activeSection !== "billing"}>
        <ProfileForm
          avatarPresentation={state.avatar}
          email={state.email}
          locale={locale}
          mode="edit"
          onSectionChange={changeSection}
          profile={state.profile}
          section={activeSection === "billing" ? "billing" : "profile"}
        />
      </div>
    </>
  );
}

/**
 * The reservations, profile notice, and deletion of an account without a
 * profile, hidden while a session section is open.
 */
function AccountWithoutProfilePanels({
  accountPasskeys,
  locale,
  sessionSectionActive,
  state,
}: {
  readonly accountPasskeys: AccountPasskeys | undefined;
  readonly locale: Locale;
  readonly sessionSectionActive: boolean;
  readonly state: AccountWithoutProfileState;
}) {
  const { activeSection } = useAccountLayout();
  const reservations = "reservations" in state ? state.reservations : undefined;

  return (
    <div hidden={sessionSectionActive}>
      <div className="grid items-start gap-6">
        {reservations && (
          <div hidden={activeSection !== "reservations"}>
            {reservations.history}
          </div>
        )}
        <ProfileNotice locale={locale} state={state} />
        <AccountDeletion
          accountPasskeys={accountPasskeys}
          locale={locale}
          state={state}
        />
      </div>
    </div>
  );
}

/** The navigation's referral badge: the earned discount, none at 0%. */
const referralNavigationBadge = (
  referrals: ReferralAccountOverview | undefined,
  locale: Locale
) => {
  const discount = referrals?.summary.discount;
  if (discount === undefined || discount === "0") return undefined;
  return {
    text: formatReferralDiscountReduction(discount, locale),
    label: m.accountReferralsNavigationBadgeLabel(
      { discount: formatReferralDiscount(discount, locale) },
      { locale }
    ),
  };
};

const cardClassName =
  "rounded-3xl border-white/70 bg-white/92 shadow-[0_26px_80px_-48px_rgba(0,2,79,0.55)]";

/** The card explaining why the profile isn't shown; none while deletion is pending. */
function ProfileNotice({
  locale,
  state,
}: {
  readonly locale: Locale;
  readonly state: AccountWithoutProfileState;
}) {
  switch (state.kind) {
    case "authenticated-unavailable":
      return <AccountUnavailableCard locale={locale} />;
    case "completion-required":
      return (
        <CompletionCard
          email={state.email}
          locale={locale}
          referralCode={state.referralCode}
          referralsEnabled={state.referralsEnabled}
        />
      );
    case "support-required":
      return <SupportRequiredCard locale={locale} />;
    case "review-account":
      return <ReviewAccountCard locale={locale} />;
    case "deletion-pending":
      return null;
  }
}

/** The account can't be read right now, signed in or not. */
export function AccountUnavailableCard({
  locale,
}: {
  readonly locale: Locale;
}) {
  return (
    <Card
      className="mx-auto max-w-xl p-8 text-center"
      id="account-profile-unavailable"
    >
      <h2 className="text-3xl text-navy-blue">
        {m.accountUnavailableTitle({}, { locale })}
      </h2>
      <p className="mt-4 leading-7 text-navy-blue/68">
        {m.accountUnavailableDescription({}, { locale })}
      </p>
    </Card>
  );
}

function CompletionCard({
  email,
  locale,
  referralCode,
  referralsEnabled,
}: Pick<
  Extract<SignedInAccountState, { readonly kind: "completion-required" }>,
  "email" | "referralCode" | "referralsEnabled"
> & { readonly locale: Locale }) {
  return (
    <Card
      className={`mx-auto max-w-2xl ${cardClassName}`}
      id="account-completion-required"
    >
      <CardContent className="p-6 @xl:p-10">
        <h2 className="text-3xl text-navy-blue @xl:text-4xl">
          {m.accountCompletionTitle({}, { locale })}
        </h2>
        <p className="mt-3 text-sm leading-6 text-navy-blue/68">
          {m.accountCompletionBody({}, { locale })}
        </p>
        <div className="mt-8">
          <ProfileForm
            email={email}
            locale={locale}
            mode="complete"
            referralCode={referralCode}
            referralsEnabled={referralsEnabled}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function SupportRequiredCard({ locale }: { readonly locale: Locale }) {
  return (
    <Card className={`mx-auto max-w-2xl ${cardClassName}`}>
      <CardContent className="p-6 text-center @xl:p-10">
        <h2 className="text-3xl text-navy-blue @xl:text-4xl">
          {m.accountSupportTitle({}, { locale })}
        </h2>
        <p className="mt-4 leading-7 text-navy-blue/68">
          <Interpolate
            string={m.accountSupportContact({}, { locale })}
            mapping={{
              contact: (label) => (
                <Link
                  href={`/${locale}/contact`}
                  className="text-burned-orange underline underline-offset-4"
                >
                  {label}
                </Link>
              ),
            }}
          />
        </p>
      </CardContent>
    </Card>
  );
}
