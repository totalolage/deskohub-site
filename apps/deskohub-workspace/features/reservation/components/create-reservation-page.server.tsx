import "server-only";

import { Effect, Option } from "effect";
import { connection } from "next/server";
import type { ReactNode } from "react";
import {
  openPayState,
  payStateContinuesOn,
  payStateTokenQueryParam,
} from "@/features/checkout/backend/checkout";
import type { CheckoutSessionId } from "@/features/checkout/checkout-identifiers";
import {
  type CanonicalPromotionCode,
  discountCodeQueryParam,
  normalizeSubmittedPromotionCode,
} from "@/features/discounts";
import type { Locale } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import {
  publicPageMetadata,
  requirePublishedPublicPage,
} from "@/features/public-pages/backend/public-page-route.server";
import type { PublicPageBreadcrumb } from "@/features/public-pages/components/public-page-breadcrumbs";
import { publicPageDefinitions } from "@/features/public-pages/public-page-definitions";
import type { PublicPagePathname } from "@/features/public-pages/public-pages";
import { checkoutContactReturnState } from "@/features/reservation/backend/checkout-contact-return-state";
import { loadReservationCheckoutAccount } from "@/features/reservation/backend/reservation-existing-customer.server";
import {
  checkoutContactQueryParam,
  type ReservationCheckoutContact,
} from "@/features/reservation/reservation-checkout-contact";
import type { ReservationCheckoutAccount } from "@/features/reservation/reservation-existing-customer";
import type { ReservationOrderData } from "@/features/reservation/reservation-order";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { getSearchParam, type SearchParamsRecord } from "@/shared/utils";
import { ReservationPage } from "./reservation-page";

type ReservationKind = ReservationOrderData["kind"];

type ReservationForKind<Kind extends ReservationKind> = Extract<
  ReservationOrderData,
  { readonly kind: Kind }
>;

type ReservationPageContext<Kind extends ReservationKind, PageData> = {
  /** Who reaches the contact-details step. */
  readonly checkoutAccount: ReservationCheckoutAccount<Kind>;
  /** Contact details typed before an email verification that led here. */
  readonly checkoutContact?: ReservationCheckoutContact;
  readonly checkoutSessionId?: CheckoutSessionId;
  readonly initialReservation?: ReservationForKind<Kind>;
  readonly locale: Locale;
  /** Customer-independent data from the definition's `loadPageData`. */
  readonly pageData: PageData;
  readonly replacementToken?: string;
  readonly searchParams: SearchParamsRecord;
  readonly submittedCode?: CanonicalPromotionCode;
};

type ReservationPageDefinition<
  Kind extends ReservationKind,
  PageData = undefined,
> = {
  /**
   * The pages above this one, ending with it, when a landing page leads
   * here. The home page goes first on its own.
   */
  readonly breadcrumbs?: (
    locale: Locale
  ) => ReadonlyArray<PublicPageBreadcrumb>;
  readonly fallback: (locale: Locale) => ReactNode;
  readonly kind: Kind;
  /**
   * The page's public pathname, whose definition gives its title,
   * description and release gate.
   */
  readonly pathname: PublicPagePathname;
  readonly render: (
    context: ReservationPageContext<Kind, PageData>
  ) => ReactNode | Promise<ReactNode>;
} & ([PageData] extends [undefined]
  ? { readonly loadPageData?: undefined }
  : {
      /**
       * Loads data that depends on neither the visitor nor the restored
       * reservation, alongside them. A rejection fails the page.
       */
      readonly loadPageData: () => Promise<PageData>;
    });

type LocalizedReservationPageProps = {
  readonly searchParams: Promise<SearchParamsRecord>;
};

export const loadRestoredReservation = Effect.fn(
  "reservationPage.loadRestoredReservation"
)(function* <Kind extends ReservationKind>(
  token: string | undefined,
  locale: Locale,
  kind: Kind
) {
  if (!token) return undefined;

  const payState = Option.getOrUndefined(
    yield* openPayState(token).pipe(Effect.option)
  );
  if (
    !payState ||
    !payStateContinuesOn(payState, { locale, reservationKind: kind })
  ) {
    return undefined;
  }

  return {
    checkoutSessionId: payState.checkoutSessionId,
    initialReservation: payState.reservation as ReservationForKind<Kind>,
    replacementToken: token,
    // Restored requested intent (or the applied code on older tokens) wins
    // over a fresh public discount-code query parameter.
    submittedCode: payState.requestedDiscountCode ?? payState.submittedCode,
  };
});

/**
 * Opens the contact details a signed-out customer typed before verifying the
 * email. An expired or foreign token leaves the form as it would otherwise
 * open.
 */
const loadCheckoutContact = (token: string | undefined) =>
  token
    ? checkoutContactReturnState
        .open(token)
        .pipe(Effect.option, Effect.map(Option.getOrUndefined))
    : Effect.succeed(undefined);

export function createReservationPage<
  const Kind extends ReservationKind,
  PageData = undefined,
>(definition: ReservationPageDefinition<Kind, PageData>) {
  const generateMetadata = publicPageMetadata(definition.pathname);

  async function Page({ searchParams }: LocalizedReservationPageProps) {
    return runWithRequestLocale(async (locale) => (
      <ReservationPage
        breadcrumbs={definition.breadcrumbs?.(locale)}
        fallback={definition.fallback(locale)}
        locale={locale}
        title={publicPageDefinitions[definition.pathname].title({}, { locale })}
      >
        <ReservationPageContent
          definition={definition}
          searchParams={searchParams}
        />
      </ReservationPage>
    ));
  }

  return { generateMetadata, Page };
}

async function ReservationPageContent<Kind extends ReservationKind, PageData>({
  definition,
  searchParams,
}: {
  readonly definition: ReservationPageDefinition<Kind, PageData>;
  readonly searchParams: Promise<SearchParamsRecord>;
}) {
  await connection();
  // The release gate may read the request subject, so it stays out of the
  // prerendered shell. Disabled pages stream the not-found boundary instead.
  await requirePublishedPublicPage(definition.pathname);
  const resolvedSearchParams = await searchParams;

  return runWithRequestLocale(async (locale) => {
    const normalizedCode = await normalizeSubmittedPromotionCode({
      submittedCode: getSearchParam(
        resolvedSearchParams,
        discountCodeQueryParam
      ),
    }).pipe(
      Effect.orElseSucceed(() => Option.none()),
      runWorkspaceEffect(`reservation.${definition.kind}.normalize-code`)
    );
    const submittedCode = Option.getOrUndefined(normalizedCode);
    // None of these depends on another: the restored reservation and the
    // checkout contact read only their sealed tokens, the checkout account
    // only the session, and the page data neither. Every step before render
    // waits on the slowest of them.
    const [restoredReservation, checkoutContact, checkoutAccount, pageData] =
      await Promise.all([
        loadRestoredReservation(
          getSearchParam(resolvedSearchParams, payStateTokenQueryParam),
          locale,
          definition.kind
        ).pipe(runWorkspaceEffect(`reservation.${definition.kind}.load-state`)),
        loadCheckoutContact(
          getSearchParam(resolvedSearchParams, checkoutContactQueryParam)
        ).pipe(
          runWorkspaceEffect(`reservation.${definition.kind}.load-contact`)
        ),
        loadReservationCheckoutAccount(definition.kind),
        definition.loadPageData?.(),
      ]);

    return definition.render({
      checkoutAccount,
      checkoutContact,
      locale,
      // A definition without a loader has `undefined` page data.
      pageData: pageData as PageData,
      searchParams: resolvedSearchParams,
      submittedCode,
      ...restoredReservation,
    });
  });
}
