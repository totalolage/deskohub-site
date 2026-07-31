import "server-only";

import { Effect, Option } from "effect";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import {
  openPayState,
  payStateTokenQueryParam,
} from "@/features/checkout/backend/checkout";
import { isLocale, type Locale, locales } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import type { ReservationOrderData } from "@/features/reservation/reservation-order";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import {
  getSearchParam,
  getWorkspaceLocalizedCanonicalUrl,
  type SearchParamsRecord,
  workspaceSiteConstants,
} from "@/shared/utils";
import { ReservationPage } from "./reservation-page";

type ReservationKind = ReservationOrderData["kind"];

type ReservationForKind<Kind extends ReservationKind> = Extract<
  ReservationOrderData,
  { readonly kind: Kind }
>;

type ReservationPageContext<Kind extends ReservationKind> = {
  readonly checkoutSessionId?: string;
  readonly initialReservation?: ReservationForKind<Kind>;
  readonly locale: Locale;
  readonly replacementToken?: string;
  readonly searchParams: SearchParamsRecord;
};

type ReservationPageDefinition<Kind extends ReservationKind> = {
  readonly kind: Kind;
  readonly metadata: (locale: Locale) => {
    readonly description: string;
    readonly title: string;
  };
  readonly pathname: string;
  readonly render: (context: ReservationPageContext<Kind>) =>
    | {
        readonly children: ReactNode;
        readonly fallback: ReactNode;
      }
    | Promise<{
        readonly children: ReactNode;
        readonly fallback: ReactNode;
      }>;
};

type LocalizedReservationPageProps = {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<SearchParamsRecord>;
};

const loadRestoredReservation = Effect.fn(
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
    payState.locale !== locale ||
    payState.reservation.kind !== kind
  ) {
    return undefined;
  }

  return {
    checkoutSessionId: payState.checkoutSessionId,
    initialReservation: payState.reservation as ReservationForKind<Kind>,
    replacementToken: token,
  };
});

export function createReservationPage<const Kind extends ReservationKind>(
  definition: ReservationPageDefinition<Kind>
) {
  async function generateMetadata({
    params,
  }: LocalizedReservationPageProps): Promise<Metadata> {
    const { locale } = await params;
    if (!isLocale(locale)) notFound();

    return runWithRequestLocale(locale, () => {
      const { description, title } = definition.metadata(locale);
      const url = getWorkspaceLocalizedCanonicalUrl(
        locale,
        definition.pathname
      );

      return {
        title,
        description,
        alternates: {
          canonical: url,
          languages: Object.fromEntries(
            locales.map((itemLocale) => [
              itemLocale,
              getWorkspaceLocalizedCanonicalUrl(
                itemLocale,
                definition.pathname
              ),
            ])
          ),
        },
        openGraph: {
          title,
          description,
          url,
          siteName: workspaceSiteConstants.brand.name,
          locale,
          type: "website",
        },
      } satisfies Metadata;
    });
  }

  async function Page({ params, searchParams }: LocalizedReservationPageProps) {
    const [{ locale }, resolvedSearchParams] = await Promise.all([
      params,
      searchParams,
    ]);
    if (!isLocale(locale)) notFound();

    return runWithRequestLocale(locale, async () => {
      const restoredReservation = await loadRestoredReservation(
        getSearchParam(resolvedSearchParams, payStateTokenQueryParam),
        locale,
        definition.kind
      ).pipe(runWorkspaceEffect(`reservation.${definition.kind}.load-state`));
      const content = await definition.render({
        locale,
        searchParams: resolvedSearchParams,
        ...restoredReservation,
      });

      return (
        <ReservationPage fallback={content.fallback} locale={locale}>
          {content.children}
        </ReservationPage>
      );
    });
  }

  return { generateMetadata, Page };
}
