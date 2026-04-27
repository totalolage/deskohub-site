import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import type { WorkspaceLocale } from "@/features/i18n";
import { m } from "@/features/i18n";
import {
  type ReservationEntryTier,
  type ReservationMonitorOption,
  reservationEntryTiers,
  reservationMonitorOptions,
} from "@/features/reservation/schemas/reservation";
import { Container } from "@/shared/components/container";
import { Button } from "@/shared/components/ui/button";

export type ReservationConfirmationSearchParams = Record<
  string,
  string | string[] | undefined
>;

export type ReservationConfirmationDetails =
  | {
      isCustomized: true;
      tier: ReservationEntryTier;
      date: string;
      coffee: boolean;
      monitor?: ReservationMonitorOption;
    }
  | {
      isCustomized: false;
    };

type ReservationConfirmationPageProps = {
  locale: WorkspaceLocale;
  details: ReservationConfirmationDetails;
};

type SummaryRow = {
  label: string;
  value: string;
};

const tierMessageKeys = {
  "basic-day-pass": "reservationTierBasicTitle",
  "cowork-plus": "reservationTierCoworkTitle",
  "profi-workstation": "reservationTierProfiTitle",
} as const satisfies Record<ReservationEntryTier, keyof typeof m>;

const monitorMessageKeys = {
  "2x27": "reservationMonitor2x27Title",
  "2x32": "reservationMonitor2x32Title",
  "qhd-4k": "reservationMonitorQhd4kTitle",
} as const satisfies Record<ReservationMonitorOption, keyof typeof m>;

const strictDatePattern = /^\d{4}-\d{2}-\d{2}$/;

const getSingleSearchParam = (
  searchParams: ReservationConfirmationSearchParams,
  key: string
) => {
  const value = searchParams[key];

  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
};

const isReservationEntryTier = (
  value: string | undefined
): value is ReservationEntryTier =>
  value !== undefined &&
  reservationEntryTiers.includes(value as ReservationEntryTier);

const isReservationMonitorOption = (
  value: string | undefined
): value is ReservationMonitorOption =>
  value !== undefined &&
  reservationMonitorOptions.includes(value as ReservationMonitorOption);

const parseStrictReservationDate = (value: string | undefined) => {
  if (!value || !strictDatePattern.test(value)) {
    return undefined;
  }

  const parsedDate = new Date(`${value}T12:00:00.000Z`);

  if (Number.isNaN(parsedDate.getTime())) {
    return undefined;
  }

  const [year, month, day] = value.split("-").map(Number);
  const isSameDate =
    parsedDate.getUTCFullYear() === year &&
    parsedDate.getUTCMonth() + 1 === month &&
    parsedDate.getUTCDate() === day;

  return isSameDate ? value : undefined;
};

const parseCoffeePreference = (value: string | undefined) => {
  if (value === "1") {
    return true;
  }

  if (value === "0") {
    return false;
  }

  return undefined;
};

const formatReservationDate = (date: string, locale: WorkspaceLocale) =>
  new Date(`${date}T12:00:00.000Z`).toLocaleDateString(locale, {
    dateStyle: "full",
    timeZone: "Europe/Prague",
  });

const getMessage = (key: keyof typeof m, locale: WorkspaceLocale) => {
  const message = m[key] as (
    inputs: object,
    options: { locale: WorkspaceLocale }
  ) => string;
  return message({}, { locale }) as string;
};

export function normalizeReservationConfirmationDetails(
  searchParams: ReservationConfirmationSearchParams
): ReservationConfirmationDetails {
  const tier = getSingleSearchParam(searchParams, "tier");
  if (!isReservationEntryTier(tier)) {
    return { isCustomized: false };
  }

  const date = parseStrictReservationDate(
    getSingleSearchParam(searchParams, "date")
  );
  if (!date) {
    return { isCustomized: false };
  }

  const coffee = parseCoffeePreference(
    getSingleSearchParam(searchParams, "coffee")
  );
  if (coffee === undefined) {
    return { isCustomized: false };
  }

  const monitor = getSingleSearchParam(searchParams, "monitor");
  const parsedMonitor = isReservationMonitorOption(monitor)
    ? monitor
    : undefined;
  if (tier === "profi-workstation") {
    if (!parsedMonitor) {
      return { isCustomized: false };
    }

    return {
      isCustomized: true,
      tier,
      date,
      coffee,
      monitor: parsedMonitor,
    };
  }

  return {
    isCustomized: true,
    tier,
    date,
    coffee,
  };
}

export function ReservationConfirmationPage({
  locale,
  details,
}: ReservationConfirmationPageProps) {
  const summaryRows: SummaryRow[] = details.isCustomized
    ? [
        {
          label: String(m.reservationConfirmationTierLabel({}, { locale })),
          value: getMessage(tierMessageKeys[details.tier], locale),
        },
        {
          label: String(m.reservationConfirmationDateLabel({}, { locale })),
          value: formatReservationDate(details.date, locale),
        },
        {
          label: String(m.reservationConfirmationCoffeeLabel({}, { locale })),
          value: details.coffee
            ? m.reservationConfirmationYes({}, { locale })
            : m.reservationConfirmationNo({}, { locale }),
        },
        details.monitor
          ? {
              label: String(
                m.reservationConfirmationMonitorLabel({}, { locale })
              ),
              value: getMessage(monitorMessageKeys[details.monitor], locale),
            }
          : undefined,
      ].filter((row): row is SummaryRow => row !== undefined)
    : [];

  return (
    <main className="min-h-screen overflow-x-clip bg-navy-blue text-white">
      <section className="relative isolate overflow-hidden pb-20 pt-28 sm:pb-24 sm:pt-36">
        <div className="absolute left-1/2 top-20 -z-10 h-80 w-3xl -translate-x-1/2 rotate-[-10deg] rounded-full bg-aquamarine-green/18 blur-3xl" />
        <div className="absolute right-[-8rem] bottom-8 -z-10 h-72 w-72 rounded-full bg-burned-orange/18 blur-3xl" />

        <Container>
          <div className="mx-auto max-w-3xl">
            <div className="rounded-[2.25rem] border border-white/55 bg-white/94 p-6 text-navy-blue shadow-[0_44px_140px_-54px_rgba(0,2,79,0.62)] backdrop-blur-sm sm:p-10">
              <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-aquamarine-green/14 text-aquamarine-green ring-8 ring-aquamarine-green/8">
                  <CheckCircle2 className="h-9 w-9" aria-hidden="true" />
                </div>

                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold uppercase tracking-[0.18em] text-burned-orange">
                    {m.reservationConfirmationEyebrow({}, { locale })}
                  </p>
                  <h1 className="mt-4 text-balance text-4xl leading-none sm:text-5xl">
                    {m.reservationConfirmationTitle({}, { locale })}
                  </h1>
                  <p className="mt-5 text-lg leading-8 text-navy-blue/70">
                    {m.reservationConfirmationLead({}, { locale })}
                  </p>
                </div>
              </div>

              <div className="mt-10 rounded-[1.6rem] border border-navy-blue/10 bg-gradient-to-br from-white to-aquamarine-green/8 p-5 sm:p-6">
                <h2 className="text-xl text-navy-blue">
                  {m.reservationConfirmationDetailsTitle({}, { locale })}
                </h2>

                {details.isCustomized ? (
                  <dl className="mt-5 grid gap-3">
                    {summaryRows.map((row) => (
                      <div
                        key={row.label}
                        className="grid gap-1 rounded-[1rem] border border-navy-blue/8 bg-white/80 px-4 py-3 sm:grid-cols-[10rem_1fr] sm:gap-4"
                      >
                        <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-navy-blue/52">
                          {row.label}
                        </dt>
                        <dd className="text-base font-semibold text-navy-blue">
                          {row.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="mt-4 rounded-[1rem] border border-burned-orange/16 bg-burned-orange/8 px-4 py-3 text-sm leading-6 text-navy-blue/70">
                    {m.reservationConfirmationMissingDetails({}, { locale })}
                  </p>
                )}
              </div>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button asChild className="h-12 px-6">
                  <Link href={`/${locale}/reservation`}>
                    {m.reservationConfirmationReserveAnother({}, { locale })}
                  </Link>
                </Button>
                <Button asChild variant="secondary" className="h-12 px-6">
                  <Link href={`/${locale}`}>
                    {m.reservationConfirmationBackHome({}, { locale })}
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </Container>
      </section>
    </main>
  );
}
