import { CalendarDays, UserRound, Users } from "lucide-react";
import { FutureFeatureTooltip } from "@/features/account/components/future-feature-tooltip";
import { AccountSectionPanel } from "@/features/account/components/shell/account-section-panel";
import type {
  CustomerReservationHistory,
  CustomerReservationParty,
  CustomerReservationStatus,
  CustomerReservationSummary,
} from "@/features/account/contracts";
import {
  getWorkspaceMeetingRoomProductTitle,
  getWorkspaceOfficeProductTitle,
  getWorkspaceProductTierTitle,
} from "@/features/checkout/product-catalog.i18n";
import { type Locale, m } from "@/features/i18n";
import { formatMeetingRoomSetupStart } from "@/features/reservation/meeting-room-reservation-display-time";
import { formatReservationDisplayDateRange } from "@/features/reservation/reservation-date";
import {
  reservationAccessPath,
  reservationStatusPath,
} from "@/features/reservation/routes";
import { GuardedLink } from "@/shared/components/guarded-link";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import {
  StatusBadge,
  type StatusTone,
} from "@/shared/components/ui/status-badge";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import { isMidnight } from "@/shared/utils/temporal";

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

const getReservationPartyLabel = (
  party: CustomerReservationParty,
  locale: Locale
) => {
  switch (party.kind) {
    case "booked-for":
      return party.customerName
        ? m.accountReservationBookedFor(
            { name: party.customerName },
            { locale }
          )
        : m.accountReservationBookedForSomeoneElse({}, { locale });
    case "booked-by":
      return party.authorName
        ? m.accountReservationBookedBy({ name: party.authorName }, { locale })
        : m.accountReservationBookedByAnotherAccount({}, { locale });
    case "booked-by-deleted-account":
      return m.accountReservationBookedByDeletedAccount({}, { locale });
  }
};

const getReservationStatusTone = (
  status: CustomerReservationStatus
): StatusTone => {
  switch (status) {
    case "confirmed":
      return "positive";
    case "cancelled":
      return "neutral";
    case "requires-attention":
      return "attention";
    case "pending":
      return "progress";
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

/** The setup start of a meeting room booked with early setup. */
const formatReservationSetupStart = (
  reservation: CustomerReservationSummary,
  locale: Locale
) =>
  reservation.setupStartsAt && reservation.startsAt
    ? m.accountReservationSetupFrom(
        {
          time: formatMeetingRoomSetupStart(
            {
              setupStart: Temporal.Instant.from(reservation.setupStartsAt),
              bookedStart: Temporal.Instant.from(reservation.startsAt),
            },
            locale
          ),
        },
        { locale }
      )
    : null;

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
  history,
  locale,
}: {
  readonly history: CustomerReservationHistory;
  readonly locale: Locale;
}) {
  if (history.kind === "unavailable") {
    return <ProviderUnavailableNotice locale={locale} />;
  }

  const { groups } = history;
  const hasUndatedReservations = groups.unavailable.length > 0;

  return (
    <div className="min-w-0 space-y-8">
      {groups.current.length > 0 && (
        <CurrentReservationGroup
          locale={locale}
          reservations={groups.current}
        />
      )}
      <PastReservationGroup locale={locale} reservations={groups.past} />
      {hasUndatedReservations && (
        <UndatedReservationGroup
          locale={locale}
          reservations={groups.unavailable}
        />
      )}
    </div>
  );
}

function CurrentReservationGroup({
  locale,
  reservations,
}: {
  readonly locale: Locale;
  readonly reservations: readonly CustomerReservationSummary[];
}) {
  const [featuredReservation, ...additionalReservations] = reservations;
  if (!featuredReservation) return null;

  return (
    <AccountSectionPanel
      aria-labelledby="account-reservations-current-title"
      className="min-w-0 scroll-mt-8"
      data-account-reservation-group="current"
      id="account-reservations-current"
      title={m.accountReservationsCurrentTitle({}, { locale })}
      titleId="account-reservations-current-title"
    >
      <ul className="m-0 min-w-0 list-none space-y-3 p-0">
        <FeaturedReservationItem
          locale={locale}
          reservation={featuredReservation}
        />
      </ul>

      {additionalReservations.length > 0 && (
        <div className="mt-7 min-w-0">
          <h3 className="mb-3 break-words text-sm font-semibold uppercase tracking-[0.12em] text-[#64748b]">
            {m.accountReservationMoreCurrent({}, { locale })}
          </h3>
          <ul className="m-0 min-w-0 list-none space-y-3 p-0">
            {additionalReservations.map((reservation) => (
              <CompactReservationItem
                key={reservation.id}
                locale={locale}
                reservation={reservation}
              />
            ))}
          </ul>
        </div>
      )}
    </AccountSectionPanel>
  );
}

function FeaturedReservationItem({
  locale,
  reservation,
}: {
  readonly locale: Locale;
  readonly reservation: CustomerReservationSummary;
}) {
  const period = formatReservationPeriod(reservation, locale);
  const setupStart = formatReservationSetupStart(reservation, locale);
  const title = getReservationTitle(reservation, locale);

  return (
    <li className="min-w-0">
      <Card className="min-w-0 overflow-hidden rounded-2xl border-[#e9b8a7] bg-white shadow-[0_18px_40px_-28px_rgba(0,2,79,0.35)]">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-3 p-6 @4xl:py-4">
          <div className="flex min-w-0 max-w-full flex-1 flex-wrap items-center gap-3">
            <StatusBadge
              className="max-w-full min-w-0 break-words whitespace-normal"
              data-account-reservation-status={reservation.status}
              tone={getReservationStatusTone(reservation.status)}
            >
              {getStatusLabel(reservation.status, locale)}
            </StatusBadge>
            <code className="min-w-0 max-w-full break-all font-mono text-sm text-[#64748b]">
              {reservation.id}
            </code>
          </div>
          <div className="min-w-0 max-w-full text-left @xl:max-w-[45%] @xl:text-right">
            <span className="block text-xs font-semibold uppercase tracking-[0.1em] text-[#64748b]">
              {m.accountReservationProduct({}, { locale })}
            </span>
            <span className="mt-1 block break-words text-sm font-semibold leading-5 text-[#344258]">
              {title}
            </span>
          </div>
        </div>

        <div className="border-t border-[#dfe4ec]" />

        <div className="grid min-w-0 gap-6 px-6 py-6 @4xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(10rem,0.8fr)] @4xl:py-5">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#64748b]">
              {m.accountReservationProduct({}, { locale })}
            </p>
            <h3 className="mt-2 break-words text-xl font-semibold leading-tight tracking-[-0.02em] text-[#00024f]">
              {title}
            </h3>
            <p className="mt-3 flex min-w-0 items-center gap-2 break-words text-sm text-[#64748b]">
              <Users aria-hidden="true" className="size-4 shrink-0" />
              <span>
                {reservation.seats === null
                  ? m.accountFeatureUnavailable({}, { locale })
                  : m.accountReservationSeats(
                      { count: reservation.seats },
                      { locale }
                    )}
              </span>
            </p>
            {reservation.party && (
              <p className="mt-2 text-sm text-[#64748b]">
                <ReservationPartyNote
                  locale={locale}
                  party={reservation.party}
                />
              </p>
            )}
          </div>

          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#64748b]">
              {m.accountReservationValidity({}, { locale })}
            </p>
            {period ? (
              <p className="mt-3 flex min-w-0 items-start gap-2 break-words text-sm leading-6 text-[#344258] @4xl:mt-2">
                <CalendarDays
                  aria-hidden="true"
                  className="mt-1 size-4 shrink-0"
                />
                <span>{period}</span>
              </p>
            ) : (
              <p className="mt-3 text-sm text-[#64748b]">
                {m.accountFeatureUnavailable({}, { locale })}
              </p>
            )}
            {setupStart && (
              <p className="mt-1 pl-6 text-sm text-[#64748b]">{setupStart}</p>
            )}
          </div>

          <div className="min-w-0 rounded-xl bg-[#f6f8fa] p-4 text-sm text-[#475569]">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <span className="min-w-0 break-words">
                {m.accountReservationAssignedDesk({}, { locale })}
              </span>
              <span className="shrink-0 font-medium text-[#475569]">
                {m.accountFeatureUnavailable({}, { locale })}
              </span>
            </div>
            <div className="mt-3 flex min-w-0 items-start justify-between gap-3">
              <span className="min-w-0 break-words">
                {m.accountReservationWifi({}, { locale })}
              </span>
              <span className="shrink-0 font-medium text-[#475569]">
                {m.accountFeatureUnavailable({}, { locale })}
              </span>
            </div>
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-4 border-t border-[#dfe4ec] p-6 @3xl:flex-row @3xl:items-center @3xl:justify-between @4xl:grid @4xl:grid-cols-[minmax(0,1fr)_auto] @4xl:gap-x-4 @4xl:gap-y-2 @4xl:px-6 @4xl:py-4">
          <div className="flex min-w-0 flex-col gap-2 @3xl:flex-row @3xl:flex-wrap @4xl:col-start-1 @4xl:row-start-2">
            <FutureFeatureTooltip locale={locale}>
              <Button
                className="@3xl:w-auto"
                fullWidth
                disabled
                size="sm"
                type="button"
                variant="secondary"
              >
                {m.accountReservationCheckIn({}, { locale })}
              </Button>
            </FutureFeatureTooltip>
            {reservation.workspaceReservationId &&
            !reservation.reviewSandbox ? (
              <Button
                asChild
                className="@3xl:w-auto"
                fullWidth
                size="sm"
                variant="secondary"
              >
                <GuardedLink
                  href={`/${locale}${reservationAccessPath}/${encodeURIComponent(reservation.workspaceReservationId)}`}
                >
                  {m.accountReservationShowPinCode({}, { locale })}
                </GuardedLink>
              </Button>
            ) : (
              <div className="min-w-0">
                <Button
                  className="@3xl:w-auto"
                  fullWidth
                  disabled
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  {m.accountReservationShowPinCode({}, { locale })}
                </Button>
                <p className="mt-2 max-w-sm break-words text-xs leading-5 text-[#64748b]">
                  {reservation.reviewSandbox
                    ? m.accountReservationPinReviewSandbox({}, { locale })
                    : m.accountReservationPinUnavailable({}, { locale })}
                </p>
              </div>
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-3 @3xl:items-end @4xl:contents">
            <p className="max-w-sm break-words text-sm leading-5 text-[#64748b] @4xl:col-start-1 @4xl:row-start-1 @4xl:max-w-none @4xl:text-xs @4xl:leading-5">
              {m.accountFeatureUnavailableDescription({}, { locale })}
            </p>
            {reservation.workspaceReservationId && (
              <div className="@4xl:col-start-2 @4xl:row-span-2 @4xl:row-start-1 @4xl:flex @4xl:items-center @4xl:justify-self-end">
                <ReservationDetailLink
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
  locale,
  reservation,
}: {
  readonly locale: Locale;
  readonly reservation: CustomerReservationSummary;
}) {
  const dateTile = formatReservationDateTile(reservation.startsAt, locale);
  const period = formatReservationPeriod(reservation, locale);
  const setupStart = formatReservationSetupStart(reservation, locale);

  return (
    <li className="min-w-0">
      <article className="min-w-0 rounded-2xl border border-[#dfe4ec] bg-white p-4 shadow-[0_12px_30px_-24px_rgba(0,2,79,0.45)] @2xl:min-h-[74px]">
        <div className="flex min-w-0 flex-col gap-4 @2xl:flex-row @2xl:items-center">
          <div className="flex size-14 shrink-0 flex-col items-center justify-center rounded-xl border border-[#dbe4ff] bg-[#f3f6ff] px-1 text-center text-[#344258]">
            <span className="sr-only">
              {m.accountReservationDate({}, { locale })}:{" "}
              {dateTile
                ? `${dateTile.month} ${dateTile.day}`
                : m.accountFeatureUnavailable({}, { locale })}
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
                {m.accountFeatureUnavailable({}, { locale })}
              </span>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <p className="sr-only">
              {m.accountReservationProduct({}, { locale })}
            </p>
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
                  <span className="sr-only">
                    {m.accountReservationValidity({}, { locale })}:{" "}
                  </span>
                  {m.accountFeatureUnavailable({}, { locale })}
                </span>
              )}
              {setupStart && <span>{setupStart}</span>}
              <span className="inline-flex items-center gap-1.5">
                <Users aria-hidden="true" className="size-4 shrink-0" />
                <span>
                  {reservation.seats === null
                    ? m.accountFeatureUnavailable({}, { locale })
                    : m.accountReservationSeats(
                        { count: reservation.seats },
                        { locale }
                      )}
                </span>
              </span>
              {reservation.party && (
                <ReservationPartyNote
                  locale={locale}
                  party={reservation.party}
                />
              )}
            </div>
          </div>

          <div className="flex min-w-0 flex-col items-stretch gap-3 @2xl:flex-row @2xl:items-center">
            <span className="sr-only">
              {m.accountReservationStatus({}, { locale })}:{" "}
            </span>
            <StatusBadge
              className="max-w-full min-w-0 self-start break-words whitespace-normal"
              data-account-reservation-status={reservation.status}
              tone={getReservationStatusTone(reservation.status)}
            >
              {getStatusLabel(reservation.status, locale)}
            </StatusBadge>
            <ReservationDetailLink locale={locale} reservation={reservation} />
          </div>
        </div>
      </article>
    </li>
  );
}

function PastReservationGroup({
  locale,
  reservations,
}: {
  readonly locale: Locale;
  readonly reservations: readonly CustomerReservationSummary[];
}) {
  return (
    <AccountSectionPanel
      actions={
        <span className="rounded-full bg-[#f3f5f8] px-2.5 py-1 text-xs font-semibold text-[#64748b]">
          {reservations.length}
        </span>
      }
      aria-labelledby="account-reservations-past-title"
      className="min-w-0 scroll-mt-8"
      data-account-reservation-group="past"
      id="account-reservations-past"
      title={m.accountReservationsPastTitle({}, { locale })}
      titleId="account-reservations-past-title"
    >
      {reservations.length === 0 ? (
        <GroupEmptyNotice
          empty={m.accountReservationsPastEmpty({}, { locale })}
        />
      ) : (
        <PastReservationTable locale={locale} reservations={reservations} />
      )}
    </AccountSectionPanel>
  );
}

function PastReservationTable({
  locale,
  reservations,
}: {
  readonly locale: Locale;
  readonly reservations: readonly CustomerReservationSummary[];
}) {
  return (
    <CardContent className="min-w-0 overflow-hidden p-0">
      <table
        aria-labelledby="account-reservations-past-title"
        className="block w-full text-left @4xl:table @4xl:table-fixed"
      >
        <thead className="hidden border-b border-[#dfe4ec] text-xs font-semibold uppercase tracking-[0.1em] text-[#64748b] @4xl:table-header-group">
          <tr className="block @4xl:table-row">
            <th className="px-3 py-3 @4xl:w-[30%]" scope="col">
              {m.accountReservationDate({}, { locale })}
            </th>
            <th className="px-3 py-3 @4xl:w-[25%]" scope="col">
              {m.accountReservationProduct({}, { locale })}
            </th>
            <th className="px-3 py-3 @4xl:w-[12%]" scope="col">
              {m.accountReservationSeatsLabel({}, { locale })}
            </th>
            <th className="px-3 py-3 @4xl:w-[17%]" scope="col">
              {m.accountReservationStatus({}, { locale })}
            </th>
            <th className="px-3 py-3 text-right @4xl:w-[16%]" scope="col">
              <span className="sr-only">
                {m.accountReservationView({}, { locale })}
              </span>
            </th>
          </tr>
        </thead>
        <tbody className="block @4xl:table-row-group">
          {reservations.map((reservation) => (
            <tr
              className="block min-w-0 border-b border-[#dfe4ec] last:border-0 @max-4xl:p-4 @4xl:table-row"
              key={reservation.id}
            >
              <td className="block min-w-0 break-words px-0 py-1 align-top text-sm text-[#344258] @4xl:table-cell @4xl:w-[30%] @4xl:px-3 @4xl:py-4">
                <div className="flex min-w-0 items-baseline justify-between gap-4 @4xl:block">
                  <span className="block shrink-0 text-xs font-semibold uppercase tracking-[0.08em] text-[#64748b] @4xl:hidden">
                    {m.accountReservationDate({}, { locale })}
                  </span>
                  <span className="break-words">
                    {formatReservationPeriod(reservation, locale) ??
                      m.accountFeatureUnavailable({}, { locale })}
                    <PastReservationSetupStart
                      locale={locale}
                      reservation={reservation}
                    />
                  </span>
                </div>
              </td>
              <td className="block min-w-0 break-words px-0 py-1 align-top text-sm font-semibold text-[#344258] @4xl:table-cell @4xl:w-[25%] @4xl:px-3 @4xl:py-4">
                <div className="flex min-w-0 items-baseline justify-between gap-4 @4xl:block">
                  <span className="block shrink-0 text-xs font-semibold uppercase tracking-[0.08em] text-[#64748b] @4xl:hidden">
                    {m.accountReservationProduct({}, { locale })}
                  </span>
                  <span className="min-w-0 break-words">
                    {getReservationTitle(reservation, locale)}
                    {reservation.party && (
                      <span className="mt-1 block text-xs font-normal text-[#64748b]">
                        <ReservationPartyNote
                          locale={locale}
                          party={reservation.party}
                        />
                      </span>
                    )}
                  </span>
                </div>
              </td>
              <td className="block min-w-0 break-words px-0 py-1 align-top text-sm text-[#344258] @4xl:table-cell @4xl:w-[12%] @4xl:px-3 @4xl:py-4">
                <div className="flex min-w-0 items-baseline justify-between gap-4 @4xl:block">
                  <span className="block shrink-0 text-xs font-semibold uppercase tracking-[0.08em] text-[#64748b] @4xl:hidden">
                    {m.accountReservationSeatsLabel({}, { locale })}
                  </span>
                  <span className="break-words">
                    {reservation.seats === null
                      ? m.accountFeatureUnavailable({}, { locale })
                      : m.accountReservationSeats(
                          { count: reservation.seats },
                          { locale }
                        )}
                  </span>
                </div>
              </td>
              <td className="block min-w-0 px-0 py-1 align-top text-sm text-[#344258] @4xl:table-cell @4xl:w-[17%] @4xl:px-3 @4xl:py-4">
                <div className="flex min-w-0 items-baseline justify-between gap-4 @4xl:block">
                  <span className="block shrink-0 text-xs font-semibold uppercase tracking-[0.08em] text-[#64748b] @4xl:hidden">
                    {m.accountReservationStatus({}, { locale })}
                  </span>
                  <StatusBadge
                    className="max-w-full min-w-0 break-words whitespace-normal"
                    data-account-reservation-status={reservation.status}
                    tone={getReservationStatusTone(reservation.status)}
                  >
                    {getStatusLabel(reservation.status, locale)}
                  </StatusBadge>
                </div>
              </td>
              <td className="block min-w-0 px-0 pt-3 align-top text-right @4xl:table-cell @4xl:w-[16%] @4xl:px-3 @4xl:py-4">
                <div className="flex min-w-0 justify-end">
                  <ReservationDetailLink
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

function PastReservationSetupStart({
  locale,
  reservation,
}: {
  readonly locale: Locale;
  readonly reservation: CustomerReservationSummary;
}) {
  const setupStart = formatReservationSetupStart(reservation, locale);
  return (
    setupStart && (
      <span className="mt-1 block text-xs text-[#64748b]">{setupStart}</span>
    )
  );
}

function UndatedReservationGroup({
  locale,
  reservations,
}: {
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
            key={reservation.id}
            locale={locale}
            reservation={reservation}
          />
        ))}
      </ul>
    </section>
  );
}

function ReservationPartyNote({
  locale,
  party,
}: {
  readonly locale: Locale;
  readonly party: CustomerReservationParty;
}) {
  return (
    <span
      className="inline-flex min-w-0 items-start gap-1.5 break-words"
      data-account-reservation-party={party.kind}
    >
      <UserRound aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>{getReservationPartyLabel(party, locale)}</span>
    </span>
  );
}

function ReservationDetailLink({
  locale,
  presentation = "button",
  reservation,
}: {
  readonly locale: Locale;
  readonly presentation?: "button" | "text";
  readonly reservation: CustomerReservationSummary;
}) {
  if (!reservation.workspaceReservationId) return null;

  const href = getReservationHref(locale, reservation.workspaceReservationId);

  if (presentation === "text") {
    return (
      <Button asChild variant="link" wrap>
        <GuardedLink href={href}>
          {m.accountReservationView({}, { locale })}
        </GuardedLink>
      </Button>
    );
  }

  return (
    <Button asChild size="sm" variant="secondary" wrap>
      <GuardedLink href={href}>
        {m.accountReservationView({}, { locale })}
      </GuardedLink>
    </Button>
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
