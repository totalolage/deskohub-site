import {
  getLocaleFromPathname,
  stripLocaleFromPathname,
} from "@deskohub/i18n/pathname";
import { Effect } from "effect";
import { payStateTokenQueryParam } from "@/features/checkout/pay-state-token-query";
import type { Locale } from "@/features/i18n";
import { locales } from "@/features/i18n/routing";
import { reservationAccessTokenQueryParam } from "@/features/reservation/reservation-access-token";
import type { ReservationOrderData } from "@/features/reservation/reservation-order";
import {
  coworkReservationPath,
  meetingRoomReservationPath,
  officeReservationPath,
  reservationInvoicePath,
} from "@/features/reservation/routes";

const checkoutPayPath = "/checkout/pay";

const restorationPages: Readonly<Record<string, ReservationOrderData["kind"]>> =
  {
    [coworkReservationPath]: "cowork",
    [meetingRoomReservationPath]: "meeting-room",
    [officeReservationPath]: "office",
  };

/**
 * A URL that may continue a flow bound to the locale its signed value was
 * issued in. Only a verified candidate keeps that locale:
 * - The Pay page, and the reservation pages that restore an edited
 *   reservation, take a Pay state. It fixes the language of the terms and
 *   operating rules the customer accepts and of the frozen accounting
 *   snapshot (the invoice language).
 * - The invoice page takes a reservation access token and issues the invoice
 *   in the reservation's locale.
 * Status and access links are exchanged for a locale-free cookie before any
 * locale decision, so their token never reaches this check.
 */
export type LocaleBoundContinuation =
  | {
      readonly kind: "pay-state";
      readonly locale: Locale;
      /** The restoration page's reservation kind; absent on the Pay page. */
      readonly reservationKind?: ReservationOrderData["kind"];
      readonly token: string;
    }
  | {
      readonly kind: "reservation-invoice";
      readonly locale: Locale;
      readonly orderId: string;
      readonly token: string;
    };

/**
 * The value the page reads: the first raw value, exactly as given. Only an
 * empty value counts as absent; whitespace is kept, so the verifier sees what
 * the page will validate.
 */
const pageParam = (searchParams: Pick<URLSearchParams, "get">, param: string) =>
  searchParams.get(param) || undefined;

type ContinuationCandidate = {
  readonly locale: Locale;
  readonly route: string;
  readonly searchParams: Pick<URLSearchParams, "get">;
};

/**
 * A Pay state on the Pay page, or on a reservation page that restores an
 * edited reservation of the matching kind.
 */
const findPayStateContinuation = ({
  locale,
  route,
  searchParams,
}: ContinuationCandidate): LocaleBoundContinuation | undefined => {
  const token = pageParam(searchParams, payStateTokenQueryParam);
  if (!token) return undefined;
  if (route === checkoutPayPath) return { kind: "pay-state", locale, token };
  const reservationKind = restorationPages[route];
  return reservationKind
    ? { kind: "pay-state", locale, reservationKind, token }
    : undefined;
};

/** The single path segment after the invoice route, when there is one. */
const invoiceOrderId = (route: string) => {
  if (!route.startsWith(`${reservationInvoicePath}/`)) return undefined;
  const orderId = route.slice(reservationInvoicePath.length + 1);
  return /^[^/]+$/.test(orderId) ? orderId : undefined;
};

const findInvoiceContinuation = ({
  locale,
  route,
  searchParams,
}: ContinuationCandidate): LocaleBoundContinuation | undefined => {
  const token = pageParam(searchParams, reservationAccessTokenQueryParam);
  const orderId = invoiceOrderId(route);
  return token && orderId
    ? { kind: "reservation-invoice", locale, orderId, token }
    : undefined;
};

/**
 * The continuation a URL claims to carry: a supported route with a non-empty
 * first value of its signed parameter, as the page reads it. This only matches the URL's shape and reads
 * no secret, so callers must verify the candidate before keeping its locale.
 */
export const findLocaleBoundContinuation = ({
  pathname,
  searchParams,
}: {
  readonly pathname: string;
  readonly searchParams: Pick<URLSearchParams, "get">;
}): LocaleBoundContinuation | undefined => {
  const locale = getLocaleFromPathname(pathname, locales);
  if (!locale) return undefined;
  const candidate = {
    locale,
    route: stripLocaleFromPathname(pathname, locales),
    searchParams,
  };
  return (
    findPayStateContinuation(candidate) ?? findInvoiceContinuation(candidate)
  );
};

/**
 * The saved preference to apply to a page: none for a guest, none when the
 * page is a verified continuation issued in another locale, and the saved
 * preference otherwise. A request without a known page (a Server Action sent
 * without a referrer) has no continuation to check. `verify` runs only for a
 * candidate the preference would move, so most requests never load or run
 * it. A verifier that fails for any reason, including a failed lazy import or
 * a throw, counts as "does not verify": the failure is logged once and the
 * preference applies.
 */
export const preferenceApplyingTo = Effect.fn(
  "LocaleBoundContinuation.preferenceApplyingTo"
)(function* <E>(
  page: Parameters<typeof findLocaleBoundContinuation>[0] | undefined,
  savedPreference: Locale | undefined,
  verify: (continuation: LocaleBoundContinuation) => Effect.Effect<boolean, E>
) {
  if (savedPreference === undefined) return undefined;
  const continuation = page && findLocaleBoundContinuation(page);
  if (!continuation || continuation.locale === savedPreference) {
    return savedPreference;
  }
  // Catching the whole cause keeps defects in the verifier from ever
  // blocking the preference.
  return yield* Effect.suspend(() => verify(continuation)).pipe(
    Effect.map((verified) => (verified ? undefined : savedPreference)),
    Effect.catchCause(() =>
      Effect.logWarning(
        "Locale-bound continuation could not be verified; the saved preference applies.",
        { code: "i18n.locale-bound-continuation.verify-failed" }
      ).pipe(Effect.as(savedPreference))
    )
  );
});
