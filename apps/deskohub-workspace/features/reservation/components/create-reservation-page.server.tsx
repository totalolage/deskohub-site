import "server-only";

import { Effect, Option } from "effect";
import { connection } from "next/server";
import type { ReactNode } from "react";
import type {
  AdvertisedPriceRequest,
  PreloadedAdvertisedPrice,
} from "@/features/checkout/advertised-price";
import {
  openPayState,
  payStateContinuesOn,
  payStateTokenQueryParam,
} from "@/features/checkout/backend/checkout";
import type { CheckoutSessionId } from "@/features/checkout/checkout-identifiers";
import { PublicOfferingsStructuredData } from "@/features/checkout/components/public-offerings-structured-data";
import type { PublicPriceListOffering } from "@/features/checkout/public-offerings";
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
import { ReservationPagePreloads } from "@/features/reservation/backend/reservation-page-preloads.service";
import {
  checkoutContactQueryParam,
  type ReservationCheckoutContact,
} from "@/features/reservation/reservation-checkout-contact";
import { getReservationCustomerQueryMode } from "@/features/reservation/reservation-checkout-query";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import {
  type CustomerLastReservationForKind,
  getCheckoutAccountLastReservation,
  getReservationCheckoutCustomerForm,
  type ReservationCheckoutAccount,
  type ReservationCheckoutCustomerForm,
  type ReservationCheckoutFormValues,
} from "@/features/reservation/reservation-existing-customer";
import type { ReservationOrderData } from "@/features/reservation/reservation-order";
import type {
  PreloadedWorkspaceAvailability,
  WorkspaceAvailabilityQuery,
} from "@/features/reservation/workspace-availability";
import { SealedStateKeys } from "@/shared/backend/sealed-state-keys.service";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { getSearchParam, type SearchParamsRecord } from "@/shared/utils";
import { ReservationPage } from "./reservation-page";

type ReservationKind = ReservationOrderData["kind"];

type ReservationForKind<Kind extends ReservationKind> = Extract<
  ReservationOrderData,
  { readonly kind: Kind }
>;

/** What a page's family decides from, after the request loads. */
type ReservationPageRequest<Kind extends ReservationKind, PageData> = {
  /** Who reaches the contact-details step. */
  readonly checkoutAccount: ReservationCheckoutAccount<Kind>;
  /** Contact details typed before an email verification that led here. */
  readonly checkoutContact?: ReservationCheckoutContact;
  readonly locale: Locale;
  /** Customer-independent data from the definition's `loadPageData`. */
  readonly pageData: PageData;
  /** The signed reservation a Pay return or edit link reopens. */
  readonly restoredReservation?: RestoredReservation<Kind>;
  readonly searchParams: SearchParamsRecord;
  readonly submittedCode?: CanonicalPromotionCode;
};

type RestoredReservation<Kind extends ReservationKind> = {
  readonly checkoutSessionId?: CheckoutSessionId;
  readonly reservation: ReservationForKind<Kind>;
  readonly replacementToken: string;
  readonly submittedCode?: CanonicalPromotionCode;
};

/** The page inputs every family step can read. */
type ReservationPageScope<PageData> = {
  readonly locale: Locale;
  readonly pageData: PageData;
  readonly submittedCode?: CanonicalPromotionCode;
  /** The Prague workspace date the server renders on. */
  readonly today: string;
};

/** What a signed reservation reopens on its family's page. */
export type ReservationPageRestoration<Values> =
  /** The signed selection, with any selection the URL names beside it. */
  | { readonly kind: "restored"; readonly values: Values }
  /**
   * The signed reservation can't reopen the form, as once its interval has
   * ended. The page opens as a link without a selection would, keeping the
   * checkout it continues.
   */
  | { readonly kind: "ended" }
  /** The signed offer no longer exists; the page shows `content` instead. */
  | { readonly kind: "replaced"; readonly content: ReactNode };

/** The data a family's form opens with. */
export type ReservationPageForm<PageData, Values> = {
  readonly checkoutCustomer: ReservationCheckoutCustomerForm;
  readonly checkoutSessionId?: CheckoutSessionId;
  readonly initialAdvertisedPrices: ReadonlyArray<PreloadedAdvertisedPrice>;
  readonly initialAvailability: ReadonlyArray<PreloadedWorkspaceAvailability>;
  readonly initialValues: Values;
  readonly locale: Locale;
  readonly pageData: PageData;
  readonly replacementToken?: string;
  readonly submittedCode?: CanonicalPromotionCode;
  readonly today: string;
};

/** What a reservation page renders inside its content boundary. */
type ReservationPageContent<PageData, Values> =
  | {
      readonly kind: "form";
      readonly form: ReservationPageForm<PageData, Values>;
      /** The offerings the page's structured data lists. */
      readonly offerings: ReadonlyArray<PublicPriceListOffering>;
    }
  | { readonly kind: "replaced"; readonly content: ReactNode };

type ReservationPageDefinition<
  Kind extends ReservationKind,
  PageData,
  Values extends ReservationCheckoutFormValues,
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
  /**
   * Whether a link's contact parameters (name, email, phone) open the
   * contact-details step on that contact. Without them only an explicit
   * `customer` parameter chooses the mode.
   */
  readonly prefillsContact: boolean;
  /**
   * The form values a link opens with, filled from the customer's last
   * reservation of the family where the family allows. A signed reservation
   * that can't reopen the form reads an empty link.
   */
  readonly read: (
    searchParams: SearchParamsRecord,
    scope: ReservationPageScope<PageData> & {
      readonly lastReservation:
        | CustomerLastReservationForKind<Kind>
        | undefined;
    }
  ) => Effect.Effect<Values>;
  /** What a signed reservation reopens, with the URL beside its token. */
  readonly restore: (
    reservation: ReservationForKind<Kind>,
    searchParams: SearchParamsRecord,
    scope: ReservationPageScope<PageData>
  ) => ReservationPageRestoration<Values>;
  /** The prices and availability the form reads first for its values. */
  readonly preload: (
    values: Values,
    scope: ReservationPageScope<PageData>
  ) => {
    readonly advertisedPrices: ReadonlyArray<AdvertisedPriceRequest>;
    readonly availability: ReadonlyArray<WorkspaceAvailabilityQuery>;
  };
  /** The offerings the structured data lists, priced from the preload. */
  readonly offerings: (
    values: Values,
    advertisedPrices: ReadonlyArray<PreloadedAdvertisedPrice>,
    scope: ReservationPageScope<PageData>
  ) => ReadonlyArray<PublicPriceListOffering>;
  readonly renderForm: (
    form: ReservationPageForm<PageData, Values>
  ) => ReactNode;
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
    yield* openPayState(token).pipe(
      Effect.provide(SealedStateKeys.Default),
      Effect.option
    )
  );
  if (
    !payState ||
    !payStateContinuesOn(payState, { locale, reservationKind: kind })
  ) {
    return undefined;
  }

  return {
    checkoutSessionId: payState.checkoutSessionId,
    reservation: payState.reservation as ReservationForKind<Kind>,
    replacementToken: token,
    // Restored requested intent (or the applied code on older tokens) wins
    // over a fresh public discount-code query parameter.
    submittedCode: payState.requestedDiscountCode ?? payState.submittedCode,
  } satisfies RestoredReservation<Kind>;
});

/**
 * Opens the contact details a signed-out customer typed before verifying the
 * email, for the page in `locale`. An expired or foreign token leaves the form
 * as it would otherwise open.
 */
const loadCheckoutContact = (token: string | undefined, locale: Locale) =>
  token
    ? checkoutContactReturnState
        .open(token, locale)
        .pipe(
          Effect.provide(SealedStateKeys.Default),
          Effect.option,
          Effect.map(Option.getOrUndefined)
        )
    : Effect.succeed(undefined);

export function createReservationPage<
  const Kind extends ReservationKind,
  Values extends ReservationCheckoutFormValues,
  PageData = undefined,
>(definition: ReservationPageDefinition<Kind, PageData, Values>) {
  const generateMetadata = publicPageMetadata(definition.pathname);

  async function Page({ searchParams }: LocalizedReservationPageProps) {
    return runWithRequestLocale(async (locale) => (
      <ReservationPage
        breadcrumbs={definition.breadcrumbs?.(locale)}
        fallback={definition.fallback(locale)}
        locale={locale}
        title={publicPageDefinitions[definition.pathname].title({}, { locale })}
      >
        <ReservationPageRequestContent
          definition={definition}
          searchParams={searchParams}
        />
      </ReservationPage>
    ));
  }

  return {
    generateMetadata,
    /**
     * The content the page renders for a loaded request, before it becomes
     * elements. The page provides the live preloads.
     */
    loadContent: (request: ReservationPageRequest<Kind, PageData>) =>
      loadReservationPageContent(definition, request),
    Page,
  };
}

async function ReservationPageRequestContent<
  Kind extends ReservationKind,
  PageData,
  Values extends ReservationCheckoutFormValues,
>({
  definition,
  searchParams,
}: {
  readonly definition: ReservationPageDefinition<Kind, PageData, Values>;
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
          getSearchParam(resolvedSearchParams, checkoutContactQueryParam),
          locale
        ).pipe(
          runWorkspaceEffect(`reservation.${definition.kind}.load-contact`)
        ),
        loadReservationCheckoutAccount(definition.kind),
        definition.loadPageData?.(),
      ]);

    const content = await loadReservationPageContent(definition, {
      checkoutAccount,
      checkoutContact,
      locale,
      // A definition without a loader has `undefined` page data.
      pageData: pageData as PageData,
      restoredReservation,
      searchParams: resolvedSearchParams,
      // A restored checkout keeps its own discount intent, even none.
      submittedCode: restoredReservation
        ? restoredReservation.submittedCode
        : Option.getOrUndefined(normalizedCode),
    }).pipe(
      Effect.provide(ReservationPagePreloads.Default),
      runWorkspaceEffect(`reservation.${definition.kind}.load-content`, {
        boundary: "page",
      })
    );

    if (content.kind === "replaced") return content.content;
    return (
      <>
        <PublicOfferingsStructuredData
          locale={locale}
          offerings={content.offerings}
        />
        {definition.renderForm(content.form)}
      </>
    );
  });
}

/**
 * The selection the form opens on: the family's restored values, its
 * replacement content, or the link's selection.
 */
const loadReservationPageSelection = Effect.fnUntraced(function* <
  Kind extends ReservationKind,
  PageData,
  Values extends ReservationCheckoutFormValues,
>(
  definition: ReservationPageDefinition<Kind, PageData, Values>,
  request: ReservationPageRequest<Kind, PageData>,
  scope: ReservationPageScope<PageData>
) {
  const { restoredReservation } = request;
  const restoration = restoredReservation
    ? definition.restore(
        restoredReservation.reservation,
        request.searchParams,
        scope
      )
    : undefined;
  if (restoration?.kind === "replaced" || restoration?.kind === "restored") {
    return restoration;
  }

  // A signed reservation decides the page even once it can't reopen the
  // form: its fallback reads no public query values, neither a selection
  // nor a contact mode.
  const values = yield* definition.read(
    restoredReservation ? {} : request.searchParams,
    {
      ...scope,
      lastReservation: getCheckoutAccountLastReservation(
        request.checkoutAccount
      ),
    }
  );
  return { kind: "read", values } as const;
});

/**
 * The reservation page recipe: the family's selection, restored or read from
 * the link, the contact-details step, both preloads side by side, and the
 * offerings priced from them.
 */
const loadReservationPageContent = Effect.fn("reservationPage.loadContent")(
  function* <
    Kind extends ReservationKind,
    PageData,
    Values extends ReservationCheckoutFormValues,
  >(
    definition: ReservationPageDefinition<Kind, PageData, Values>,
    request: ReservationPageRequest<Kind, PageData>
  ) {
    const { checkoutAccount, locale, pageData, restoredReservation } = request;
    const scope: ReservationPageScope<PageData> = {
      locale,
      pageData,
      submittedCode: request.submittedCode,
      today: getCurrentWorkspaceDate().toString(),
    };
    const selection = yield* loadReservationPageSelection(
      definition,
      request,
      scope
    );
    if (selection.kind === "replaced") {
      return {
        kind: "replaced",
        content: selection.content,
      } satisfies ReservationPageContent<PageData, Values>;
    }

    const { checkoutCustomer, initialValues } =
      getReservationCheckoutCustomerForm({
        account: checkoutAccount,
        checkoutContact: request.checkoutContact,
        queryMode: restoredReservation
          ? undefined
          : getReservationCustomerQueryMode(request.searchParams, {
              prefillsContact: definition.prefillsContact,
            }),
        restored: selection.kind === "restored",
        values: selection.values,
      });

    const replacementToken = restoredReservation?.replacementToken;
    const preload = definition.preload(initialValues, scope);
    const preloads = yield* ReservationPagePreloads;
    const [initialAdvertisedPrices, initialAvailability] = yield* Effect.all(
      [
        preloads.advertisedPrices(preload.advertisedPrices),
        preloads.availability({
          queries: preload.availability,
          replacementToken,
        }),
      ],
      { concurrency: "unbounded" }
    );

    return {
      kind: "form",
      form: {
        checkoutCustomer,
        checkoutSessionId: restoredReservation?.checkoutSessionId,
        initialAdvertisedPrices,
        initialAvailability,
        initialValues,
        locale,
        pageData,
        replacementToken,
        submittedCode: scope.submittedCode,
        today: scope.today,
      },
      offerings: definition.offerings(
        initialValues,
        initialAdvertisedPrices,
        scope
      ),
    } satisfies ReservationPageContent<PageData, Values>;
  }
);
