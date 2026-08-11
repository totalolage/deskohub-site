import "server-only";

import { Effect, Option } from "effect";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import type { ReactNode } from "react";
import {
  openPayState,
  payStateTokenQueryParam,
} from "@/features/checkout/backend/checkout";
import type { CheckoutSessionId } from "@/features/checkout/checkout-identifiers";
import { type Locale, locales } from "@/features/i18n";
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
  readonly checkoutSessionId?: CheckoutSessionId;
  readonly initialReservation?: ReservationForKind<Kind>;
  readonly locale: Locale;
  readonly replacementToken?: string;
  readonly searchParams: SearchParamsRecord;
};

type ReservationPageDefinition<Kind extends ReservationKind> = {
  readonly fallback: (locale: Locale) => ReactNode;
  readonly isEnabled?: () => boolean | Promise<boolean>;
  readonly kind: Kind;
  readonly metadata: (locale: Locale) => {
    readonly description: string;
    readonly title: string;
  };
  readonly pathname: string;
  readonly render: (
    context: ReservationPageContext<Kind>
  ) => ReactNode | Promise<ReactNode>;
};

type LocalizedReservationPageProps = {
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
  async function generateMetadata(): Promise<Metadata> {
    return runWithRequestLocale(async (locale) => {
      if (definition.isEnabled && !(await definition.isEnabled())) notFound();

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

  async function Page({ searchParams }: LocalizedReservationPageProps) {
    return runWithRequestLocale(async (locale) => {
      if (definition.isEnabled && !(await definition.isEnabled())) notFound();

      return (
        <ReservationPage fallback={definition.fallback(locale)} locale={locale}>
          <ReservationPageContent
            definition={definition}
            searchParams={searchParams}
          />
        </ReservationPage>
      );
    });
  }

  return { generateMetadata, Page };
}

async function ReservationPageContent<Kind extends ReservationKind>({
  definition,
  searchParams,
}: {
  readonly definition: ReservationPageDefinition<Kind>;
  readonly searchParams: Promise<SearchParamsRecord>;
}) {
  await connection();
  const resolvedSearchParams = await searchParams;

  return runWithRequestLocale(async (locale) => {
    const restoredReservation = await loadRestoredReservation(
      getSearchParam(resolvedSearchParams, payStateTokenQueryParam),
      locale,
      definition.kind
    ).pipe(runWorkspaceEffect(`reservation.${definition.kind}.load-state`));

    return definition.render({
      locale,
      searchParams: resolvedSearchParams,
      ...restoredReservation,
    });
  });
}
