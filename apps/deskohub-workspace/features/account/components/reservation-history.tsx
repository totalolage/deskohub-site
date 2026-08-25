import { CalendarDays, Users } from "lucide-react";
import {
  getWorkspaceMeetingRoomProductTitle,
  getWorkspaceOfficeProductTitle,
  getWorkspaceProductTierTitle,
} from "@/features/checkout/product-catalog.i18n";
import { type Locale, m } from "@/features/i18n";
import { Badge } from "@/shared/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import type {
  CustomerReservationHistory,
  CustomerReservationStatus,
  CustomerReservationSummary,
} from "../contracts";

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
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: workspaceSiteConstants.location.timeZone,
  }).formatRange(new Date(reservation.startsAt), new Date(reservation.endsAt));
};

const getUnavailableDescription = (
  reason: Extract<
    CustomerReservationHistory,
    { readonly kind: "unavailable" }
  >["reason"],
  locale: Locale
) => {
  switch (reason) {
    case "email-unverified":
      return m.accountReservationsEmailUnverified({}, { locale });
    case "link-required":
      return m.accountReservationsLinkRequired({}, { locale });
    case "provider-unavailable":
      return m.accountReservationsProviderUnavailable({}, { locale });
  }
};

export function ReservationHistory({
  history,
  locale,
}: {
  readonly history: CustomerReservationHistory;
  readonly locale: Locale;
}) {
  return (
    <Card className="rounded-3xl border-white/70 bg-white/92 shadow-[0_26px_80px_-48px_rgba(0,2,79,0.55)]">
      <CardHeader>
        <CardTitle className="text-2xl">
          {m.accountReservationsTitle({}, { locale })}
        </CardTitle>
        <CardDescription className="leading-6">
          {m.accountReservationsDescription({}, { locale })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {history.kind === "unavailable" ? (
          <div className="rounded-2xl border border-sunset-yellow/25 bg-sunset-yellow/10 p-5">
            <h3 className="text-lg text-navy-blue">
              {m.accountReservationsUnavailableTitle({}, { locale })}
            </h3>
            <p className="mt-2 text-sm leading-6 text-navy-blue/68">
              {getUnavailableDescription(history.reason, locale)}
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            <ReservationGroup
              id="current"
              title={m.accountReservationsCurrentTitle({}, { locale })}
              empty={m.accountReservationsCurrentEmpty({}, { locale })}
              reservations={history.groups.current}
              locale={locale}
            />
            <ReservationGroup
              id="past"
              title={m.accountReservationsPastTitle({}, { locale })}
              empty={m.accountReservationsPastEmpty({}, { locale })}
              reservations={history.groups.past}
              locale={locale}
              subdued
            />
            {history.groups.unavailable.length > 0 ? (
              <ReservationGroup
                id="unavailable"
                title={m.accountReservationsOtherTitle({}, { locale })}
                empty=""
                reservations={history.groups.unavailable}
                locale={locale}
                subdued
              />
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ReservationGroup({
  empty,
  id,
  locale,
  reservations,
  subdued,
  title,
}: {
  readonly empty: string;
  readonly id: "current" | "past" | "unavailable";
  readonly locale: Locale;
  readonly reservations: readonly CustomerReservationSummary[];
  readonly subdued?: boolean;
  readonly title: string;
}) {
  return (
    <section
      aria-labelledby={`account-reservations-${id}-title`}
      data-account-reservation-group={id}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3
          id={`account-reservations-${id}-title`}
          className="text-lg text-navy-blue"
        >
          {title}
        </h3>
        <span className="rounded-full bg-navy-blue/5 px-2.5 py-1 text-xs font-semibold text-navy-blue/60">
          {reservations.length}
        </span>
      </div>
      {reservations.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-navy-blue/14 px-4 py-6 text-sm text-navy-blue/58">
          {empty}
        </p>
      ) : (
        <ul className="space-y-3">
          {reservations.map((reservation) => (
            <ReservationItem
              key={reservation.id}
              reservation={reservation}
              locale={locale}
              subdued={subdued}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ReservationItem({
  locale,
  reservation,
  subdued,
}: {
  readonly locale: Locale;
  readonly reservation: CustomerReservationSummary;
  readonly subdued?: boolean;
}) {
  const period = formatReservationPeriod(reservation, locale);
  return (
    <li
      className={`rounded-2xl border border-navy-blue/10 p-4 ${
        subdued ? "bg-navy-blue/[0.025]" : "bg-white"
      }`}
    >
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <h4 className="text-base text-navy-blue">
            {getReservationTitle(reservation, locale)}
          </h4>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-sm text-navy-blue/62">
            {period ? (
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays aria-hidden className="size-4" />
                {period}
              </span>
            ) : null}
            {reservation.seats !== null ? (
              <span className="inline-flex items-center gap-1.5">
                <Users aria-hidden className="size-4" />
                {m.accountReservationSeats(
                  { count: reservation.seats },
                  { locale }
                )}
              </span>
            ) : null}
          </div>
        </div>
        <Badge className={getStatusClassName(reservation.status)}>
          {getStatusLabel(reservation.status, locale)}
        </Badge>
      </div>
    </li>
  );
}
