import { connection } from "next/server";
import { SignInCard } from "@/features/account/components/sign-in-card";
import {
  parseSignInPurpose,
  signInNoLongerWaitingNotice,
  signInNoticeParam,
  signInPurposeParam,
  signInReturnParam,
} from "@/features/account/routes";
import { arePasskeysEnabled } from "@/features/account/server/account-feature-flag.server";
import type { Locale } from "@/features/i18n";
import { parseSameOriginPath } from "@/shared/utils/same-origin-path";
import {
  getSearchParam,
  type SearchParamsRecord,
} from "@/shared/utils/search-params";

/**
 * The sign-in card of the sign-in page and its modal. A same-origin
 * `returnTo` query makes the sign-in continue there; anything else is
 * ignored, so the sign-in returns to the account. A `notice` query naming
 * `signInNoLongerWaitingNotice` shows that notice above the form.
 */
export async function SignInRouteCard({
  locale,
  searchParams,
}: {
  readonly locale: Locale;
  readonly searchParams: Promise<SearchParamsRecord>;
}) {
  await connection();
  // Passkey sign-in itself stays open while the flag is off; only the
  // sign-in card's offer hides.
  const [passkeysEnabled, query] = await Promise.all([
    arePasskeysEnabled(),
    searchParams,
  ]);
  const returnTo = parseSameOriginPath(
    getSearchParam(query, signInReturnParam)
  );

  return (
    <SignInCard
      locale={locale}
      noLongerWaiting={
        getSearchParam(query, signInNoticeParam) === signInNoLongerWaitingNotice
      }
      passkeysEnabled={passkeysEnabled}
      purpose={parseSignInPurpose(getSearchParam(query, signInPurposeParam))}
      returnTo={returnTo}
    />
  );
}
