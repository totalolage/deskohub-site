import { CloudinaryImage } from "@deskohub/cloudinary-image";
import Interpolate from "@doist/react-interpolate";
import { ArrowDown, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { getWorkspaceProductTierTitle } from "@/features/checkout/product-catalog.i18n";
import type { PublicPriceListOffering } from "@/features/checkout/public-offerings";
import type { VenuePhoto } from "@/features/gallery/types/venue-photo";
import { type Locale, m } from "@/features/i18n";
import { getOfferingSale } from "@/features/pricing/offering-sale";
import { PublicPageBreadcrumbs } from "@/features/public-pages/components/public-page-breadcrumbs";
import {
  getCoworkReservationPath,
  getMeetingRoomReservationPath,
} from "@/features/reservation/routes";
import { getSelectionPath } from "@/features/reservation/selection-path";
import { Button } from "@/shared/components/ui/button";
import { textLink } from "@/shared/components/ui/text-link";
import { formatMoney } from "@/shared/money/money";
import { cn } from "@/shared/utils";
import {
  getCoworkingAmenities,
  getCoworkingDesks,
  getCoworkingSteps,
} from "../coworking-page-content";

type CoworkingPageProps = {
  /** The cowork offerings at the prices every visitor shares. */
  readonly offerings: ReadonlyArray<PublicPriceListOffering>;
  readonly photos: readonly VenuePhoto[];
  readonly locale: Locale;
};

const sectionHeading =
  "text-[clamp(2.75rem,5vw,5rem)] leading-[0.98] tracking-[-0.055em] text-balance";

/** The coworking landing page: both desks, the space, and how a day goes. */
export function CoworkingPage({
  offerings,
  photos,
  locale,
}: CoworkingPageProps) {
  const [heroPhoto, ...morePhotos] = photos;

  return (
    <main className="overflow-x-clip bg-navy-blue text-white">
      <CoworkingHero locale={locale} photo={heroPhoto} />
      <CoworkingDesks locale={locale} offerings={offerings} />
      <CoworkingAmenities locale={locale} />
      <CoworkingSteps locale={locale} />
      <CoworkingPhotos locale={locale} photos={morePhotos.slice(0, 6)} />
      <CoworkingBooking locale={locale} />
    </main>
  );
}

function CoworkingHero({
  locale,
  photo,
}: {
  readonly locale: Locale;
  readonly photo?: VenuePhoto;
}) {
  return (
    <section
      aria-labelledby="coworking-heading"
      className="relative pt-(--site-header-height)"
    >
      <div className="mx-auto grid w-full max-w-8xl items-center gap-12 px-4 pb-20 pt-10 sm:px-6 sm:pb-24 lg:grid-cols-[minmax(0,1fr)_minmax(24rem,0.92fr)] lg:gap-[clamp(3rem,5vw,5.5rem)] lg:px-8 lg:pb-28 lg:pt-14 xl:px-14">
        <div>
          <PublicPageBreadcrumbs
            crumbs={[
              {
                pathname: "/coworking",
                name: m.coworkingBreadcrumb({}, { locale }),
              },
            ]}
            locale={locale}
            tone="inverse"
          />
          <h1
            className="mt-10 max-w-4xl text-[clamp(3.25rem,7vw,7.25rem)] leading-[0.9] tracking-[-0.065em] text-balance"
            id="coworking-heading"
          >
            {m.coworkingHeroTitle({}, { locale })}
          </h1>
          <p className="mt-8 max-w-[38rem] text-lg leading-[1.65] text-silver/82 sm:text-xl">
            {m.coworkingHeroIntro({}, { locale })}
          </p>

          <div className="mt-9 flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
            <Button
              asChild
              tone="chilean-fire"
              size="2xl"
              shape="rounded"
              caps
              className="group sm:min-w-[17rem]"
            >
              <Link href={getCoworkReservationPath(locale)}>
                {m.coworkReservationLink({}, { locale })}
                <ArrowUpRight
                  aria-hidden="true"
                  className="ml-auto size-5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                />
              </Link>
            </Button>
            <Button
              asChild
              variant="ghost"
              tone="inverse"
              size="2xl"
              shape="rounded"
              caps
            >
              <a href="#coworking-desks">
                {m.coworkingCompareCta({}, { locale })}
                <ArrowDown
                  aria-hidden="true"
                  className="size-4 text-burned-orange"
                />
              </a>
            </Button>
          </div>

          <ul
            aria-label={m.coworkingFactsLabel({}, { locale })}
            className="mt-10 flex flex-col items-start gap-2 text-sm text-silver/76 sm:flex-row sm:gap-0"
          >
            <li className="sm:pr-4">{m.coworkingFactMetro({}, { locale })}</li>
            <li className="sm:border-l sm:border-white/22 sm:px-4">
              {m.coworkingFactAlwaysOpen({}, { locale })}
            </li>
            <li className="sm:border-l sm:border-white/22 sm:pl-4">
              {m.coworkingFactPin({}, { locale })}
            </li>
          </ul>
        </div>

        {photo && (
          <figure className="relative m-0 before:absolute before:-inset-3 before:-z-10 before:translate-x-3 before:translate-y-3 before:rounded-[2rem] before:border before:border-burned-orange/70 max-sm:before:-inset-2 max-sm:before:translate-x-2 max-sm:before:translate-y-2">
            <div className="relative aspect-[4/5] overflow-hidden rounded-[1.75rem] border border-white/20 bg-white/6 sm:aspect-[5/4] lg:aspect-[4/5]">
              <CloudinaryImage
                alt={photo.alt}
                className="absolute inset-0 size-full object-cover"
                preload
                sizes="(min-width: 1024px) 44vw, 92vw"
                size={{ width: "fill", height: "fill" }}
                source={photo.publicId}
                variant="gallery"
              />
            </div>
          </figure>
        )}
      </div>
    </section>
  );
}

/**
 * Both desks side by side, under one ruler of the day that shows the
 * difference that matters most: how long each desk can be used.
 */
function CoworkingDesks({
  locale,
  offerings,
}: {
  readonly locale: Locale;
  readonly offerings: ReadonlyArray<PublicPriceListOffering>;
}) {
  const desks = getCoworkingDesks(locale);

  return (
    <section
      aria-labelledby="coworking-desks-heading"
      className="scroll-mt-(--site-header-height) border-t border-white/10 bg-white/[0.035]"
      id="coworking-desks"
    >
      <div className="mx-auto w-full max-w-8xl px-4 py-24 sm:px-6 sm:py-32 lg:px-8 xl:px-14">
        <div className="max-w-[50rem]">
          <h2 className={sectionHeading} id="coworking-desks-heading">
            {m.coworkingDesksTitle({}, { locale })}
          </h2>
          <p className="mt-7 max-w-[36rem] text-lg leading-[1.65] text-silver/80">
            {m.coworkingDesksIntro({}, { locale })}
          </p>
        </div>

        <figure className="m-0 mt-16 sm:mt-20">
          <figcaption className="text-sm text-silver/72">
            {m.coworkingDayRulerLabel({}, { locale })}
          </figcaption>
          <div className="mt-6 grid gap-5">
            {desks.map((desk) => (
              <div
                className="grid gap-2 sm:grid-cols-[12rem_minmax(0,1fr)] sm:items-center sm:gap-6"
                key={desk.tier}
              >
                <span className="text-lg tracking-[-0.02em]">
                  {getWorkspaceProductTierTitle(desk.tier, locale)}
                </span>
                <div className="relative h-11 rounded-full bg-white/7 ring-1 ring-white/12 ring-inset">
                  <div
                    className={cn(
                      "flex h-full items-center rounded-full px-4 text-sm font-semibold whitespace-nowrap",
                      {
                        "open-space": "bg-burned-orange",
                        "reserved-desk": "bg-sunset-yellow text-navy-blue",
                      }[desk.tier]
                    )}
                    style={{ width: `${(desk.usableUntilHour / 24) * 100}%` }}
                  >
                    {desk.hours}
                  </div>
                </div>
              </div>
            ))}
            <div
              aria-hidden="true"
              className="grid sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-6"
            >
              <div className="relative col-start-1 h-5 text-xs tabular-nums text-silver/56 sm:col-start-2">
                {[0, 6, 12, 18, 24].map((hour) => (
                  <span
                    className="absolute top-0 -translate-x-1/2 first:translate-x-0 last:-translate-x-full"
                    key={hour}
                    style={{ left: `${(hour / 24) * 100}%` }}
                  >
                    {`${String(hour).padStart(2, "0")}:00`}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </figure>

        <div className="mt-16 grid gap-6 lg:grid-cols-2">
          {desks.map((desk) => {
            const offering = offerings.find(
              (candidate) =>
                candidate.kind === "cowork" && candidate.tier === desk.tier
            );
            const sale = offering && getOfferingSale(offering, locale);
            const tierTitle = getWorkspaceProductTierTitle(desk.tier, locale);

            return (
              <article
                aria-labelledby={`coworking-desk-${desk.tier}`}
                className="flex min-w-0 flex-col rounded-[1.75rem] border border-white/14 bg-navy-blue p-5 sm:p-9"
                key={desk.tier}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
                  <h3
                    className="text-3xl tracking-[-0.035em] sm:text-4xl"
                    id={`coworking-desk-${desk.tier}`}
                  >
                    {tierTitle}
                  </h3>
                  {offering && (
                    <p className="text-2xl font-semibold text-sunset-yellow">
                      {m.pricingPerDay(
                        { price: formatMoney(offering.price, locale) },
                        { locale }
                      )}
                    </p>
                  )}
                </div>
                {sale && (
                  <p className="mt-2 text-sm text-silver/86 sm:text-right">
                    {m.pricingSalePrice(sale, { locale })}
                  </p>
                )}
                <p className="mt-6 max-w-[34rem] leading-[1.65] text-silver/80">
                  {desk.text}
                </p>
                <ul className="mt-6 grid gap-3 border-t border-white/12 pt-6 text-silver/90">
                  {desk.points.map((point) => (
                    <li className="flex gap-3 leading-6" key={point}>
                      <span
                        aria-hidden="true"
                        className="mt-2.5 size-1.5 shrink-0 rounded-full bg-burned-orange"
                      />
                      {point}
                    </li>
                  ))}
                </ul>
                <div className="mt-auto pt-9">
                  <Button
                    asChild
                    tone="chilean-fire"
                    size="xl"
                    shape="rounded"
                    caps
                    wrap
                    fullWidth
                    className="sm:w-auto"
                  >
                    <Link
                      href={getSelectionPath(locale, {
                        kind: "cowork",
                        entryTier: desk.tier,
                      })}
                    >
                      {desk.cta}
                    </Link>
                  </Button>
                </div>
              </article>
            );
          })}
        </div>

        <p className="mt-10 text-silver/76">
          <Interpolate
            string={m.coworkingPricesNote({}, { locale })}
            mapping={{
              pricing: (content) => (
                <Link
                  href={`/${locale}/pricing`}
                  className={textLink({ tone: "inverse" })}
                >
                  {content}
                </Link>
              ),
            }}
          />
        </p>
      </div>
    </section>
  );
}

function CoworkingAmenities({ locale }: { readonly locale: Locale }) {
  return (
    <section
      aria-labelledby="coworking-amenities-heading"
      className="border-t border-white/10"
    >
      <div className="mx-auto grid w-full max-w-8xl gap-14 px-4 py-24 sm:px-6 sm:py-32 lg:grid-cols-[minmax(16rem,0.58fr)_minmax(0,1.42fr)] lg:gap-[clamp(4rem,8vw,8.125rem)] lg:px-8 xl:px-14">
        <h2 className={sectionHeading} id="coworking-amenities-heading">
          {m.coworkingAmenitiesTitle({}, { locale })}
        </h2>
        <dl className="border-t border-white/18">
          {getCoworkingAmenities(locale).map((amenity) => (
            <div
              className="grid gap-2 border-b border-white/18 py-7 sm:grid-cols-[minmax(10rem,0.6fr)_minmax(0,1.4fr)] sm:gap-8"
              key={amenity.title}
            >
              <dt className="text-2xl tracking-[-0.03em]">{amenity.title}</dt>
              <dd className="m-0 leading-[1.65] text-silver/78">
                <Interpolate
                  string={amenity.text}
                  mapping={{
                    meetingRoom: (content) => (
                      <Link
                        href={getMeetingRoomReservationPath(locale)}
                        className={textLink({ tone: "inverse" })}
                      >
                        {content}
                      </Link>
                    ),
                  }}
                />
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

function CoworkingSteps({ locale }: { readonly locale: Locale }) {
  return (
    <section
      aria-labelledby="coworking-steps-heading"
      className="border-t border-white/10 bg-white/[0.035]"
    >
      <div className="mx-auto w-full max-w-8xl px-4 py-24 sm:px-6 sm:py-32 lg:px-8 xl:px-14">
        <h2 className={sectionHeading} id="coworking-steps-heading">
          {m.coworkingStepsTitle({}, { locale })}
        </h2>
        <ol className="mt-14 grid gap-px overflow-hidden rounded-[1.75rem] border border-white/14 bg-white/14 sm:grid-cols-2 lg:grid-cols-4">
          {getCoworkingSteps(locale).map((step, index) => (
            <li className="bg-navy-blue p-7 sm:p-8" key={step}>
              <span
                aria-hidden="true"
                className="text-5xl tracking-[-0.06em] text-burned-orange"
              >
                {index + 1}
              </span>
              <p className="mt-6 text-lg leading-[1.55] text-silver/88">
                {step}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function CoworkingPhotos({
  locale,
  photos,
}: {
  readonly locale: Locale;
  readonly photos: readonly VenuePhoto[];
}) {
  if (photos.length === 0) return null;

  return (
    <section
      aria-labelledby="coworking-photos-heading"
      className="bg-silver text-navy-blue"
    >
      <div className="mx-auto w-full max-w-8xl px-4 py-24 sm:px-6 sm:py-32 lg:px-8 xl:px-14">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <h2 className={sectionHeading} id="coworking-photos-heading">
            {m.coworkingPhotosTitle({}, { locale })}
          </h2>
          <Link href={`/${locale}/gallery`} className={textLink()}>
            {m.coworkingPhotosLink({}, { locale })}
          </Link>
        </div>
        <div className="mt-14 grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-3">
          {photos.map((photo) => (
            <div
              className="relative aspect-[4/3] overflow-hidden rounded-[1.25rem] bg-navy-blue/8"
              key={photo.id}
            >
              <CloudinaryImage
                alt={photo.alt}
                className="absolute inset-0 size-full object-cover"
                preload={false}
                sizes="(min-width: 1024px) 30vw, 48vw"
                size={{ width: "fill", height: "fill" }}
                source={photo.publicId}
                variant="gallery"
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CoworkingBooking({ locale }: { readonly locale: Locale }) {
  const localePath = `/${locale}`;

  return (
    <section
      aria-labelledby="coworking-booking-heading"
      className="border-t border-white/10"
    >
      <div className="mx-auto grid w-full max-w-8xl gap-10 px-4 py-24 sm:px-6 sm:py-32 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:gap-16 lg:px-8 xl:px-14">
        <div className="max-w-[44rem]">
          <h2 className={sectionHeading} id="coworking-booking-heading">
            {m.coworkingBookingTitle({}, { locale })}
          </h2>
          <p className="mt-8 text-lg leading-[1.65] text-silver/82">
            <Interpolate
              string={m.coworkingBookingText({}, { locale })}
              mapping={{
                faq: (content) => (
                  <Link
                    href={`${localePath}/faq`}
                    className={textLink({ tone: "inverse" })}
                  >
                    {content}
                  </Link>
                ),
                contact: (content) => (
                  <Link
                    href={`${localePath}/contact`}
                    className={textLink({ tone: "inverse" })}
                  >
                    {content}
                  </Link>
                ),
              }}
            />
          </p>
        </div>
        <Button
          asChild
          tone="chilean-fire"
          size="2xl"
          shape="rounded"
          caps
          className="group sm:min-w-[17rem]"
        >
          <Link href={getCoworkReservationPath(locale)}>
            {m.coworkReservationLink({}, { locale })}
            <ArrowUpRight
              aria-hidden="true"
              className="ml-auto size-5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
            />
          </Link>
        </Button>
      </div>
    </section>
  );
}
