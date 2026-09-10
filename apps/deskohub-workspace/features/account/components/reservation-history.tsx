import { CalendarDays, Users } from "lucide-react";
import { FutureFeatureTooltip } from "@/features/account/components/future-feature-tooltip";
import type {
  CustomerReservationHistory,
  CustomerReservationStatus,
  CustomerReservationSummary,
} from "@/features/account/contracts";
import {
  getWorkspaceMeetingRoomProductTitle,
  getWorkspaceOfficeProductTitle,
  getWorkspaceProductTierTitle,
} from "@/features/checkout/product-catalog.i18n";
import { type Locale, m } from "@/features/i18n";
import { formatReservationDisplayDateRange } from "@/features/reservation/reservation-date";
import {
  reservationAccessPath,
  reservationStatusPath,
} from "@/features/reservation/routes";
import { GuardedLink } from "@/shared/components/guarded-link";
import { Badge } from "@/shared/components/ui/badge";
import { Button, buttonVariants } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import { isMidnight } from "@/shared/utils/temporal";

export type ReservationHistoryCopy = {
  readonly product: string;
  readonly validity: string;
  readonly assignedDesk: string;
  readonly wifi: string;
  readonly unavailable: string;
  readonly checkIn: string;
  readonly nfcAccess: string;
  readonly showPinCode: string;
  readonly unsupportedDescription: string;
  readonly viewReservation: string;
  readonly date: string;
  readonly seats: string;
  readonly status: string;
  readonly moreCurrent: string;
};

const getReservationTitle = (
  reservation: CustomerReservationSummary,
  locale: Locale
) => {
  switch (reservation.product.kind) {
    case "cowork":
      return getWorkspaceProductTierTitle(reservation.product.tier, locale);
    case "meeting-room":
      return getWorkspaceMeetingRoomProductTitle(locale);
    case "office":
      return getWorkspaceOfficeProductTitle(locale);
    case "other":
      return m.accountReservationOtherProduct({}, { locale });
  }
};

const getStatusLabel = (status: CustomerReservationStatus, locale: Locale) => {
  switch (status) {
    case "cancelled":
      return m.accountReservationStatusCancelled({}, { locale });
    case "confirmed":
      return m.accountReservationStatusConfirmed({}, { locale });
    case "pending":
      return m.accountReservationStatusPending({}, { locale });
    case "requires-attention":
      return m.accountReservationStatusAttention({}, { locale });
  }
};

const getStatusClassName = (status: CustomerReservationStatus) => {
  switch (status) {
    case "confirmed":
      return "border-aquamarine-green/35 bg-aquamarine-green/18 text-aquamarine-ink";
    case "cancelled":
      return "border-navy-blue/12 bg-navy-blue/5 text-navy-blue/55";
    case "requires-attention":
      return "border-red-700/20 bg-red-50 text-red-800";
    case "pending":
      return "border-sunset-yellow/35 bg-sunset-yellow/18 text-navy-blue";
  }
};

const formatReservationPeriod = (
  reservation: CustomerReservationSummary,
  locale: Locale
) => {
  if (!reservation.startsAt || !reservation.endsAt) return null;
  const start = new Date(reservation.startsAt);
  const end = new Date(reservation.endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }
  if (end.getTime() > start.getTime()) {
    const startInstant = Temporal.Instant.fromEpochMilliseconds(
      start.getTime()
    );
    const endInstant = Temporal.Instant.fromEpochMilliseconds(end.getTime());
    if (
      isMidnight(
        startInstant
          .toZonedDateTimeISO(workspaceSiteConstants.location.timeZone)
          .toPlainDateTime()
      ) &&
      isMidnight(
        endInstant
          .toZonedDateTimeISO(workspaceSiteConstants.location.timeZone)
          .toPlainDateTime()
      )
    ) {
      return formatReservationDisplayDateRange(
        startInstant,
        endInstant,
        locale
      );
    }
  }
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: workspaceSiteConstants.location.timeZone,
  }).formatRange(start, end);
};

const formatReservationDateTile = (startsAt: string | null, locale: Locale) => {
  if (!startsAt) return null;
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    timeZone: workspaceSiteConstants.location.timeZone,
  }).formatToParts(date);
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return month && day ? { day, month } : null;
};

const getReservationHref = (
  locale: Locale,
  workspaceReservationId: NonNullable<
    CustomerReservationSummary["workspaceReservationId"]
  >
) =>
  `/${locale}${reservationStatusPath}/${encodeURIComponent(workspaceReservationId)}`;

export function ReservationHistory({
  copy,
  history,
  locale,
}: {
  readonly copy: ReservationHistoryCopy;
  readonly history: CustomerReservationHistory;
  readonly locale: Locale;
}) {
  if (history.kind === "unavailable") {
    return <ProviderUnavailableNotice locale={locale} />;
  }

  const { groups } = history;
  const hasUndatedReservations = groups.unavailable.length > 0;

  return (
    <section className="min-w-0">
      <header className="mb-6 flex min-w-0 flex-wrap items-center justify-between gap-4 border-b border-[#dfe4ec] pb-4">
        <h2
          className="min-w-0 break-words text-2xl font-semibold leading-tight tracking-[-0.02em] text-[#00024f]"
          id="account-reservations-current-title"
        >
          {m.accountReservationsCurrentTitle({}, { locale })}
        </h2>
      </header>

      <div className="min-w-0 space-y-8">
        <CurrentReservationGroup
          copy={copy}
          locale={locale}
          reservations={groups.current}
        />
        <PastReservationGroup
          copy={copy}
          locale={locale}
          reservations={groups.past}
        />
        {hasUndatedReservations && (
          <UndatedReservationGroup
            copy={copy}
            locale={locale}
            reservations={groups.unavailable}
          />
        )}
      </div>
    </section>
  );
}

function CurrentReservationGroup({
  copy,
  locale,
  reservations,
}: {
  readonly copy: ReservationHistoryCopy;
  readonly locale: Locale;
  readonly reservations: readonly CustomerReservationSummary[];
}) {
  const [featuredReservation, ...additionalReservations] = reservations;

  return (
    <section
      aria-labelledby="account-reservations-current-title"
      className="min-w-0 scroll-mt-8"
      data-account-reservation-group="current"
      id="account-reservations-current"
    >
      {featuredReservation ? (
        <ul className="m-0 min-w-0 list-none space-y-3 p-0">
          <FeaturedReservationItem
            copy={copy}
            locale={locale}
            reservation={featuredReservation}
          />
        </ul>
      ) : (
        <GroupEmptyNotice
          empty={m.accountReservationsCurrentEmpty({}, { locale })}
        />
      )}

      {additionalReservations.length > 0 && (
        <div className="mt-7 min-w-0">
          <h3 className="mb-3 break-words text-sm font-semibold uppercase tracking-[0.12em] text-[#64748b]">
            {copy.moreCurrent}
          </h3>
          <ul className="m-0 min-w-0 list-none space-y-3 p-0">
            {additionalReservations.map((reservation) => (
              <CompactReservationItem
                copy={copy}
                key={reservation.id}
                locale={locale}
                reservation={reservation}
              />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function FeaturedReservationItem({
  copy,
  locale,
  reservation,
}: {
  readonly copy: ReservationHistoryCopy;
  readonly locale: Locale;
  readonly reservation: CustomerReservationSummary;
}) {
  const period = formatReservationPeriod(reservation, locale);
  const title = getReservationTitle(reservation, locale);

  return (
    <li className="min-w-0">
      <Card className="min-w-0 overflow-hidden rounded-2xl border-[#e9b8a7] bg-white shadow-[0_18px_40px_-28px_rgba(0,2,79,0.35)]">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-3 p-6 xl:py-4">
          <div className="flex min-w-0 max-w-full flex-1 flex-wrap items-center gap-3">
            <Badge
              className={`max-w-full min-w-0 break-words whitespace-normal ${getStatusClassName(reservation.status)}`}
              data-account-reservation-status={reservation.status}
            >
              {getStatusLabel(reservation.status, locale)}
            </Badge>
            <code className="min-w-0 max-w-full break-all font-mono text-sm text-[#64748b]">
              {reservation.id}
            </code>
          </div>
          <div className="min-w-0 max-w-full text-left sm:max-w-[45%] sm:text-right">
            <span className="block text-xs font-semibold uppercase tracking-[0.1em] text-[#64748b]">
              {copy.product}
            </span>
            <span className="mt-1 block break-words text-sm font-semibold leading-5 text-[#344258]">
              {title}
            </span>
          </div>
        </div>

        <div className="border-t border-[#dfe4ec]" />

        <div className="grid min-w-0 gap-6 px-6 py-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(10rem,0.8fr)] xl:py-5">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#64748b]">
              {copy.product}
            </p>
            <h3 className="mt-2 break-words text-xl font-semibold leading-tight tracking-[-0.02em] text-[#00024f]">
              {title}
            </h3>
            <p className="mt-3 flex min-w-0 items-center gap-2 break-words text-sm text-[#64748b]">
              <Users aria-hidden="true" className="size-4 shrink-0" />
              <span>
                {reservation.seats === null
                  ? copy.unavailable
                  : m.accountReservationSeats(
                      { count: reservation.seats },
                      { locale }
                    )}
              </span>
            </p>
          </div>

          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#64748b]">
              {copy.validity}
            </p>
            {period ? (
              <p className="mt-3 flex min-w-0 items-start gap-2 break-words text-sm leading-6 text-[#344258] xl:mt-2">
                <CalendarDays
                  aria-hidden="true"
                  className="mt-1 size-4 shrink-0"
                />
                <span>{period}</span>
              </p>
            ) : (
              <p className="mt-3 text-sm text-[#64748b]">{copy.unavailable}</p>
            )}
          </div>

          <div className="min-w-0 rounded-xl bg-[#f6f8fa] p-4 text-sm text-[#475569]">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <span className="min-w-0 break-words">{copy.assignedDesk}</span>
              <span className="shrink-0 font-medium text-[#475569]">
                {copy.unavailable}
              </span>
            </div>
            <div className="mt-3 flex min-w-0 items-start justify-between gap-3">
              <span className="min-w-0 break-words">{copy.wifi}</span>
              <span className="shrink-0 font-medium text-[#475569]">
                {copy.unavailable}
              </span>
            </div>
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-4 border-t border-[#dfe4ec] p-6 sm:flex-row sm:items-center sm:justify-between xl:grid xl:grid-cols-[minmax(0,1fr)_auto] xl:gap-x-4 xl:gap-y-2 xl:px-6 xl:py-4">
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap xl:col-start-1 xl:row-start-2">
            <FutureFeatureTooltip locale={locale}>
              <Button
                className="w-full sm:w-auto"
                disabled
                size="sm"
                type="button"
                variant="secondary"
              >
                {copy.checkIn}
              </Button>
            </FutureFeatureTooltip>
            <FutureFeatureTooltip locale={locale}>
              <Button
                className="w-full sm:w-auto"
                disabled
                size="sm"
                type="button"
                variant="secondary"
              >
                {copy.nfcAccess}
              </Button>
            </FutureFeatureTooltip>
            {reservation.workspaceReservationId ? (
              <GuardedLink
                className={buttonVariants({
                  className: "w-full sm:w-auto",
                  size: "sm",
                  variant: "secondary",
                })}
                href={`/${locale}${reservationAccessPath}/${encodeURIComponent(reservation.workspaceReservationId)}`}
              >
                {copy.showPinCode}
              </GuardedLink>
            ) : (
              <div className="min-w-0">
                <Button
                  className="w-full sm:w-auto"
                  disabled
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  {copy.showPinCode}
                </Button>
                <p className="mt-2 max-w-sm break-words text-xs leading-5 text-[#64748b]">
                  {m.accountReservationPinUnavailable({}, { locale })}
                </p>
              </div>
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-3 sm:items-end xl:contents">
            <p className="max-w-sm break-words text-sm leading-5 text-[#64748b] xl:col-start-1 xl:row-start-1 xl:max-w-none xl:text-xs xl:leading-5">
              {copy.unsupportedDescription}
            </p>
            {reservation.workspaceReservationId && (
              <div className="xl:col-start-2 xl:row-span-2 xl:row-start-1 xl:flex xl:items-center xl:justify-self-end">
                <ReservationDetailLink
                  copy={copy}
                  locale={locale}
                  reservation={reservation}
                />
              </div>
            )}
          </div>
        </div>
      </Card>
    </li>
  );
}

function CompactReservationItem({
  copy,
  locale,
  reservation,
}: {
  readonly copy: ReservationHistoryCopy;
  readonly locale: Locale;
  readonly reservation: CustomerReservationSummary;
}) {
  const dateTile = formatReservationDateTile(reservation.startsAt, locale);
  const period = formatReservationPeriod(reservation, locale);

  return (
    <li className="min-w-0">
      <article className="min-w-0 rounded-2xl border border-[#dfe4ec] bg-white p-4 shadow-[0_12px_30px_-24px_rgba(0,2,79,0.45)] sm:min-h-[74px]">
        <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center">
          <div className="flex size-14 shrink-0 flex-col items-center justify-center rounded-xl border border-[#dbe4ff] bg-[#f3f6ff] px-1 text-center text-[#344258]">
            <span className="sr-only">
              {copy.date}:{" "}
              {dateTile
                ? `${dateTile.month} ${dateTile.day}`
                : copy.unavailable}
            </span>
            {dateTile ? (
              <>
                <span className="max-w-full break-words text-[10px] font-semibold uppercase leading-3 text-[#64748b]">
                  {dateTile.month}
                </span>
                <span className="text-lg font-bold leading-5 text-[#00024f]">
                  {dateTile.day}
                </span>
              </>
            ) : (
              <span className="break-words text-[10px] font-semibold uppercase leading-3 text-[#64748b]">
                {copy.unavailable}
              </span>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <p className="sr-only">{copy.product}</p>
            <h4 className="break-words text-base font-semibold leading-5 text-[#00024f]">
              {getReservationTitle(reservation, locale)}
            </h4>
            <div className="mt-2 flex min-w-0 flex-wrap gap-x-4 gap-y-2 text-sm text-[#64748b]">
              {period ? (
                <span className="inline-flex min-w-0 items-start gap-1.5 break-words">
                  <CalendarDays
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0"
                  />
                  <span>{period}</span>
                </span>
              ) : (
                <span>
                  <span className="sr-only">{copy.validity}: </span>
                  {copy.unavailable}
                </span>
              )}
              <span className="inline-flex items-center gap-1.5">
                <Users aria-hidden="true" className="size-4 shrink-0" />
                <span>
                  {reservation.seats === null
                    ? copy.unavailable
                    : m.accountReservationSeats(
                        { count: reservation.seats },
                        { locale }
                      )}
                </span>
              </span>
            </div>
          </div>

          <div className="flex min-w-0 flex-col items-stretch gap-3 sm:flex-row sm:items-center">
            <span className="sr-only">{copy.status}: </span>
            <Badge
              className="max-w-full min-w-0 self-start break-words whitespace-normal"
              data-account-reservation-status={reservation.status}
            >
              {getStatusLabel(reservation.status, locale)}
            </Badge>
            <ReservationDetailLink
              copy={copy}
              locale={locale}
              reservation={reservation}
            />
          </div>
        </div>
      </article>
    </li>
  );
}

function PastReservationGroup({
  copy,
  locale,
  reservations,
}: {
  readonly copy: ReservationHistoryCopy;
  readonly locale: Locale;
  readonly reservations: readonly CustomerReservationSummary[];
}) {
  return (
    <section
      aria-labelledby="account-reservations-past-title"
      className="min-w-0 scroll-mt-8"
      data-account-reservation-group="past"
      id="account-reservations-past"
    >
      <Card className="min-w-0 overflow-hidden rounded-2xl border-[#dfe4ec] bg-white shadow-none">
        <CardHeader className="flex flex-row items-center justify-between gap-4 border-b border-[#dfe4ec] p-5 sm:p-6">
          <CardTitle
            as="h3"
            className="min-w-0 break-words text-xl font-semibold text-[#00024f]"
            id="account-reservations-past-title"
          >
            {m.accountReservationsPastTitle({}, { locale })}
          </CardTitle>
          <span className="shrink-0 rounded-full bg-[#f3f5f8] px-2.5 py-1 text-xs font-semibold text-[#64748b]">
            {reservations.length}
          </span>
        </CardHeader>
        {reservations.length === 0 ? (
          <CardContent className="p-5 sm:p-6">
            <GroupEmptyNotice
              empty={m.accountReservationsPastEmpty({}, { locale })}
            />
          </CardContent>
        ) : (
          <PastReservationTable
            copy={copy}
            locale={locale}
            reservations={reservations}
          />
        )}
      </Card>
    </section>
  );
}

function PastReservationTable({
  copy,
  locale,
  reservations,
}: {
  readonly copy: ReservationHistoryCopy;
  readonly locale: Locale;
  readonly reservations: readonly CustomerReservationSummary[];
}) {
  return (
    <CardContent className="min-w-0 overflow-hidden p-0">
      <table
        aria-labelledby="account-reservations-past-title"
        className="block w-full text-left xl:table xl:table-fixed"
      >
        <thead className="hidden border-b border-[#dfe4ec] text-xs font-semibold uppercase tracking-[0.1em] text-[#64748b] xl:table-header-group">
          <tr className="block xl:table-row">
            <th className="px-3 py-3 xl:w-[30%]" scope="col">
              {copy.date}
            </th>
            <th className="px-3 py-3 xl:w-[25%]" scope="col">
              {copy.product}
            </th>
            <th className="px-3 py-3 xl:w-[12%]" scope="col">
              {copy.seats}
            </th>
            <th className="px-3 py-3 xl:w-[17%]" scope="col">
              {copy.status}
            </th>
            <th className="px-3 py-3 text-right xl:w-[16%]" scope="col">
              <span className="sr-only">{copy.viewReservation}</span>
            </th>
          </tr>
        </thead>
        <tbody className="block xl:table-row-group">
          {reservations.map((reservation) => (
            <tr
              className="block min-w-0 border-b border-[#dfe4ec] last:border-0 max-xl:p-4 xl:table-row"
              key={reservation.id}
            >
              <td className="block min-w-0 break-words px-0 py-1 align-top text-sm text-[#344258] xl:table-cell xl:w-[30%] xl:px-3 xl:py-4">
                <div className="flex min-w-0 items-baseline justify-between gap-4 xl:block">
                  <span className="block shrink-0 text-xs font-semibold uppercase tracking-[0.08em] text-[#64748b] xl:hidden">
                    {copy.date}
                  </span>
                  <span className="break-words">
                    {formatReservationPeriod(reservation, locale) ??
                      copy.unavailable}
                  </span>
                </div>
              </td>
              <td className="block min-w-0 break-words px-0 py-1 align-top text-sm font-semibold text-[#344258] xl:table-cell xl:w-[25%] xl:px-3 xl:py-4">
                <div className="flex min-w-0 items-baseline justify-between gap-4 xl:block">
                  <span className="block shrink-0 text-xs font-semibold uppercase tracking-[0.08em] text-[#64748b] xl:hidden">
                    {copy.product}
                  </span>
                  <span className="break-words">
                    {getReservationTitle(reservation, locale)}
                  </span>
                </div>
              </td>
              <td className="block min-w-0 break-words px-0 py-1 align-top text-sm text-[#344258] xl:table-cell xl:w-[12%] xl:px-3 xl:py-4">
                <div className="flex min-w-0 items-baseline justify-between gap-4 xl:block">
                  <span className="block shrink-0 text-xs font-semibold uppercase tracking-[0.08em] text-[#64748b] xl:hidden">
                    {copy.seats}
                  </span>
                  <span className="break-words">
                    {reservation.seats === null
                      ? copy.unavailable
                      : m.accountReservationSeats(
                          { count: reservation.seats },
                          { locale }
                        )}
                  </span>
                </div>
              </td>
              <td className="block min-w-0 px-0 py-1 align-top text-sm text-[#344258] xl:table-cell xl:w-[17%] xl:px-3 xl:py-4">
                <div className="flex min-w-0 items-baseline justify-between gap-4 xl:block">
                  <span className="block shrink-0 text-xs font-semibold uppercase tracking-[0.08em] text-[#64748b] xl:hidden">
                    {copy.status}
                  </span>
                  <Badge
                    className="max-w-full min-w-0 break-words whitespace-normal"
                    data-account-reservation-status={reservation.status}
                  >
                    {getStatusLabel(reservation.status, locale)}
                  </Badge>
                </div>
              </td>
              <td className="block min-w-0 px-0 pt-3 align-top text-right xl:table-cell xl:w-[16%] xl:px-3 xl:py-4">
                <div className="flex min-w-0 justify-end">
                  <ReservationDetailLink
                    copy={copy}
                    locale={locale}
                    presentation="text"
                    reservation={reservation}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </CardContent>
  );
}

function UndatedReservationGroup({
  copy,
  locale,
  reservations,
}: {
  readonly copy: ReservationHistoryCopy;
  readonly locale: Locale;
  readonly reservations: readonly CustomerReservationSummary[];
}) {
  return (
    <section
      aria-labelledby="account-reservations-unavailable-title"
      className="min-w-0 scroll-mt-8"
      data-account-reservation-group="unavailable"
      id="account-reservations-unavailable"
    >
      <div className="mb-3 flex min-w-0 items-center justify-between gap-3">
        <h3
          className="min-w-0 break-words text-sm font-semibold uppercase tracking-[0.12em] text-[#64748b]"
          id="account-reservations-unavailable-title"
        >
          {m.accountReservationsOtherTitle({}, { locale })}
        </h3>
        <span className="shrink-0 rounded-full bg-[#f3f5f8] px-2.5 py-1 text-xs font-semibold text-[#64748b]">
          {reservations.length}
        </span>
      </div>
      <ul className="m-0 min-w-0 list-none space-y-3 p-0">
        {reservations.map((reservation) => (
          <CompactReservationItem
            copy={copy}
            key={reservation.id}
            locale={locale}
            reservation={reservation}
          />
        ))}
      </ul>
    </section>
  );
}

function ReservationDetailLink({
  copy,
  locale,
  presentation = "button",
  reservation,
}: {
  readonly copy: ReservationHistoryCopy;
  readonly locale: Locale;
  readonly presentation?: "button" | "text";
  readonly reservation: CustomerReservationSummary;
}) {
  if (!reservation.workspaceReservationId) return null;

  const className =
    presentation === "text"
      ? "inline-flex min-w-0 max-w-full break-words whitespace-normal text-sm font-semibold leading-5 text-burned-orange underline-offset-4 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-burned-orange focus-visible:ring-offset-2"
      : buttonVariants({
          className: "min-w-0 max-w-full break-words whitespace-normal",
          size: "sm",
          variant: "secondary",
        });

  return (
    <GuardedLink
      className={className}
      href={getReservationHref(locale, reservation.workspaceReservationId)}
    >
      {copy.viewReservation}
    </GuardedLink>
  );
}

function GroupEmptyNotice({ empty }: { readonly empty: string }) {
  return (
    <p className="rounded-2xl border border-dashed border-[#dfe4ec] bg-white px-4 py-6 text-sm leading-6 text-[#64748b]">
      {empty}
    </p>
  );
}

function ProviderUnavailableNotice({ locale }: { readonly locale: Locale }) {
  return (
    <section className="min-w-0">
      <div className="rounded-2xl border border-[#dfe4ec] bg-white p-6 shadow-[0_18px_40px_-28px_rgba(0,2,79,0.35)]">
        <h2 className="break-words text-xl font-semibold leading-tight text-[#00024f]">
          {m.accountReservationsUnavailableTitle({}, { locale })}
        </h2>
        <p className="mt-3 break-words text-sm leading-6 text-[#64748b]">
          {m.accountReservationsProviderUnavailable({}, { locale })}
        </p>
      </div>
    </section>
  );
}
