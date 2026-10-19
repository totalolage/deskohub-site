import { Match } from "effect";
import { connection } from "next/server";
import { Suspense } from "react";
import type { PublicPriceListOffering } from "@/features/checkout/public-offerings";
import {
  formatWorkspaceMoney,
  type WorkspaceMoney,
  workspaceMoneyWithValue,
} from "@/features/checkout/workspace-money";
import { type Locale, m } from "@/features/i18n";
import { getCoworkOfferSearchParams } from "@/features/reservation/cowork-reservation-checkout-query";
import { getMeetingRoomReservationSelectionSearchParams } from "@/features/reservation/meeting-room-reservation-checkout-query";
import { getMeetingRoomReservationDurationKey } from "@/features/reservation/meeting-room-reservation-duration";
import { getReservationSelectionPath } from "@/features/reservation/reservation-checkout-query";
import { Container } from "@/shared/components/container";
import { GuardedLink as Link } from "@/shared/components/guarded-link";
import { Button } from "@/shared/components/ui/button";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import {
  loadSharedPriceList,
  loadVisitorPriceList,
} from "../backend/price-list.server";
import { getPriceFamilies } from "../price-family";

type PricingPageProps = {
  readonly locale: Locale;
};

/**
 * Prices and opening hours, all in the static shell, so agents that read
 * only the visible initial HTML find every price.
 */
export function PricingPage({ locale }: PricingPageProps) {
  const { address } = workspaceSiteConstants.location;
  const { openSpaceUsableUntil } = workspaceSiteConstants.openingHours;

  return (
    <main className="min-h-dvh overflow-x-clip bg-[linear-gradient(180deg,#05083f_0%,#0d1258_45%,#15123e_100%)] pb-20 pt-[calc(var(--site-header-height)+4rem)] text-white sm:pb-24 sm:pt-[calc(var(--site-header-height)+5rem)]">
      <Container className="max-w-4xl">
        <h1 className="text-4xl leading-tight text-balance sm:text-5xl">
          {m.pricingPageTitle({}, { locale })}
        </h1>
        <p className="mt-4 text-lg leading-8 text-white/76">
          {m.pricingIntro({}, { locale })}
        </p>

        <section aria-labelledby="pricing-hours-title" className="mt-12">
          <h2 id="pricing-hours-title" className="text-2xl sm:text-3xl">
            {m.pricingOpeningHoursTitle({}, { locale })}
          </h2>
          <ul className="mt-5 grid gap-3 text-base leading-7 text-white/86">
            <li>{m.pricingOpeningHoursSpace({}, { locale })}</li>
            <li>
              {m.pricingOpeningHoursOpenSpace(
                { until: openSpaceUsableUntil },
                { locale }
              )}
            </li>
            <li>{m.pricingOpeningHoursCodeAccess({}, { locale })}</li>
          </ul>
        </section>

        <PriceLists locale={locale} />

        <section aria-labelledby="pricing-address-title" className="mt-14">
          <h2 id="pricing-address-title" className="text-2xl sm:text-3xl">
            {m.contactAddressLabel({}, { locale })}
          </h2>
          <address className="mt-5 text-base leading-7 not-italic text-white/86">
            {address.street}, {address.cityDistrict}, {address.postalCode}{" "}
            {address.city}
          </address>
          <Link
            href={`/${locale}/contact`}
            className="mt-4 inline-block underline underline-offset-4 transition-colors hover:text-sunset-yellow focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sunset-yellow"
          >
            {m.pricingContactLink({}, { locale })}
          </Link>
        </section>
      </Container>
    </main>
  );
}

/**
 * The price list every visitor shares, prerendered outside any Suspense
 * boundary: React would put a resolved boundary's content in a hidden
 * container, which text extraction drops. Only while a release gate is
 * decided per visitor, or a shared price fell back to the catalog, does the
 * visitor's own list stream in its place.
 */
async function PriceLists({ locale }: PricingPageProps) {
  const { offerings, variesByVisitor } = await loadSharedPriceList(locale);
  const shared = <PriceList locale={locale} offerings={offerings} />;

  return variesByVisitor ? (
    <Suspense fallback={shared}>
      <VisitorPriceList locale={locale} />
    </Suspense>
  ) : (
    shared
  );
}

async function VisitorPriceList({ locale }: PricingPageProps) {
  await connection();
  const offerings = await loadVisitorPriceList(locale);

  return <PriceList locale={locale} offerings={offerings} />;
}

function PriceList({
  locale,
  offerings,
}: PricingPageProps & {
  readonly offerings: ReadonlyArray<PublicPriceListOffering>;
}) {
  return getPriceFamilies(offerings, locale).map(
    ({ kind, title, offerings: rows }) => {
      // Usage every row shares, such as the meeting-room durations', shows once.
      const sharedUsage =
        rows.length > 1 && new Set(rows.map(({ usage }) => usage)).size === 1
          ? rows[0]?.usage
          : undefined;

      return (
        <section
          key={kind}
          aria-labelledby={`pricing-${kind}-title`}
          className="mt-14"
        >
          <h2 id={`pricing-${kind}-title`} className="text-2xl sm:text-3xl">
            {title}
          </h2>
          {sharedUsage && (
            <p className="mt-3 text-base leading-7 text-white/76">
              {sharedUsage}
            </p>
          )}
          <ul className="mt-5 divide-y divide-white/14 border-y border-white/14">
            {rows.map((offering) => {
              const row = getPriceRow(offering, locale);

              return (
                <li
                  key={row.key}
                  className="grid gap-4 py-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-8"
                >
                  <div className="min-w-0">
                    <h3 className="text-xl font-semibold first-letter:uppercase">
                      {row.name}
                    </h3>
                    {!sharedUsage && (
                      <p className="mt-2 text-base leading-7 text-white/76">
                        {offering.usage}
                      </p>
                    )}
                    {row.extras.length > 0 && (
                      <ul className="mt-3 grid gap-1 text-base leading-7 text-white/86">
                        {row.extras.map((extra) => (
                          <li key={extra}>{extra}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="flex flex-col items-start gap-3 sm:items-end sm:text-right">
                    <p className="text-2xl font-semibold text-sunset-yellow">
                      {row.price}
                    </p>
                    {row.sale && (
                      <p className="max-w-64 text-sm leading-6 text-white/86">
                        {row.sale}
                      </p>
                    )}
                    <Button asChild size="md" caps>
                      <Link
                        href={row.reservationPath}
                        aria-label={row.reserveLabel}
                      >
                        {m.pricingReserveLink({}, { locale })}
                      </Link>
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      );
    }
  );
}

type PriceRow = {
  readonly key: string;
  readonly name: string;
  readonly price: string;
  readonly extras: ReadonlyArray<string>;
  readonly sale?: string;
  readonly reservationPath: string;
  readonly reserveLabel: string;
};

const getPriceRow = (
  offering: PublicPriceListOffering,
  locale: Locale
): PriceRow => {
  const format = (money: WorkspaceMoney) => formatWorkspaceMoney(money, locale);
  const perDay = (money: WorkspaceMoney) =>
    m.pricingPerDay({ price: format(money) }, { locale });
  const reserveLabel = (product: string) =>
    m.pricingReserveLabel({ product }, { locale });
  const sale = getSale(offering, locale);

  return Match.value(offering).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: (cowork): PriceRow => ({
        key: `cowork:${cowork.tier}`,
        name: cowork.name,
        price: perDay(cowork.price),
        extras: cowork.addOns.map((addOn) =>
          addOn.included
            ? m.pricingAddOnIncluded({ name: addOn.name }, { locale })
            : m.pricingAddOnPrice(
                { name: addOn.name, price: format(addOn.price) },
                { locale }
              )
        ),
        ...(sale && { sale: m.pricingSalePrice(sale, { locale }) }),
        reservationPath: getReservationSelectionPath(
          locale,
          "cowork",
          getCoworkOfferSearchParams({ entryTier: cowork.tier })
        ),
        reserveLabel: reserveLabel(cowork.name),
      }),
      "meeting-room": (meetingRoom): PriceRow => {
        const duration = getMeetingRoomReservationDurationKey(
          meetingRoom.duration
        );

        return {
          key: `meeting-room:${duration}`,
          name: meetingRoom.durationLabel,
          price: format(meetingRoom.price),
          extras: [],
          ...(sale && { sale: m.pricingSalePrice(sale, { locale }) }),
          reservationPath: getReservationSelectionPath(
            locale,
            "meeting-room",
            // No start yet: the page opens on the earliest one.
            getMeetingRoomReservationSelectionSearchParams({
              duration,
              startDateTime: "",
            })
          ),
          reserveLabel: reserveLabel(
            m.pricingMeetingRoomProduct(
              { name: meetingRoom.name, duration: meetingRoom.durationLabel },
              { locale }
            )
          ),
        };
      },
      office: (office): PriceRow => ({
        key: "office",
        name: office.name,
        price: perDay(office.price),
        extras: [
          m.pricingOfficeSeatPrice(
            { price: format(office.seatPrice) },
            { locale }
          ),
        ],
        ...(sale && { sale: m.pricingOfficeSalePrice(sale, { locale }) }),
        reservationPath: getReservationSelectionPath(locale, "office"),
        reserveLabel: reserveLabel(office.name),
      }),
    })
  );
};

/** The sale on the offering's smallest booking, when one runs today. */
const getSale = (
  { advertisedPrice }: PublicPriceListOffering,
  locale: Locale
) =>
  advertisedPrice &&
  advertisedPrice.discount.value > 0 && {
    price: formatWorkspaceMoney(advertisedPrice.price, locale),
    regularPrice: formatWorkspaceMoney(
      workspaceMoneyWithValue(
        advertisedPrice.price.value + advertisedPrice.discount.value,
        advertisedPrice.price
      ),
      locale
    ),
  };
