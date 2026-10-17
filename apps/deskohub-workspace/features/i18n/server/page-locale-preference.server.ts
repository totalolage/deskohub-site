import "server-only";

import { Effect } from "effect";
import { savedLocalePreference } from "@/features/account/server/saved-locale-preference.server";
import {
  type LocaleBoundContinuation,
  preferenceApplyingTo,
} from "@/features/checkout/locale-bound-continuation";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { withWorkspaceRequestContext } from "@/shared/backend/workspace-request-context";

type Page = Parameters<typeof preferenceApplyingTo>[0];

/**
 * The verifier loads only when the preference would move a candidate page,
 * so most requests never import the Pay state or access token code.
 */
const continuesInIssuedLocale = (continuation: LocaleBoundContinuation) =>
  Effect.tryPromise(
    () => import("@/features/checkout/backend/locale-bound-continuation.server")
  ).pipe(
    Effect.flatMap((verifier) => verifier.continuesInIssuedLocale(continuation))
  );

/**
 * The signed-in customer's saved locale preference as it applies to one
 * page of this request: none for guests or a failed read, and none for a
 * verified continuation issued in another locale.
 */
export const pageLocalePreference = (headers: Headers, page: Page) =>
  savedLocalePreference.pipe(
    Effect.flatMap((preference) =>
      preferenceApplyingTo(page, preference, continuesInIssuedLocale)
    ),
    withWorkspaceRequestContext(headers)
  );

/** The proxy's runtime edge for {@link pageLocalePreference}. */
export const readPageLocalePreference = (headers: Headers, page: Page) =>
  pageLocalePreference(headers, page).pipe(
    runWorkspaceEffect("i18n.page-locale-preference", { boundary: "route" })
  );
