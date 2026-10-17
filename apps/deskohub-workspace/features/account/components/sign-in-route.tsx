import { connection } from "next/server";
import {
  authReturnPathParam,
  parseAuthReturnPath,
} from "@/features/account/auth-return-path";
import { SignInCard } from "@/features/account/components/sign-in-card";
import { arePasskeysEnabled } from "@/features/account/server/account-feature-flag.server";
import type { Locale } from "@/features/i18n";
import {
  getSearchParam,
  type SearchParamsRecord,
} from "@/shared/utils/search-params";

/**
 * The sign-in card of the sign-in page and its modal. A valid `returnTo`
 * query makes the sign-in land there; an invalid one is ignored, so the
 * sign-in returns to the account.
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
  const returnPath = parseAuthReturnPath(
    getSearchParam(query, authReturnPathParam)
  );

  return (
    <SignInCard
      locale={locale}
      passkeysEnabled={passkeysEnabled}
      returnPath={returnPath}
    />
  );
}
