import { Match, Option, Schema } from "effect";
import { connection } from "next/server";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import type { ReservationAccessViewModel } from "@/features/reservation/backend/reservation-access.service";
import { ReservationAccessPage } from "@/features/reservation/components/reservation-access-page";
import {
  getSearchParamsDecoder,
  type SearchParamsRecord,
} from "@/shared/utils";

type ReservationAccessPreviewPageProps = {
  searchParams: Promise<SearchParamsRecord>;
};

const decodePreviewSearchParams = getSearchParamsDecoder(
  Schema.Struct({
    state: Schema.optional(
      Schema.Literals(["upcoming", "available", "ended", "unavailable"])
    ),
  })
);

const getPreviewAccess = (
  state: "upcoming" | "available" | "ended" | "unavailable",
  now: Temporal.Instant
): ReservationAccessViewModel =>
  Match.value(state).pipe(
    Match.when("upcoming", () => ({
      state: "upcoming" as const,
      availableAt: now.add({ hours: 1, minutes: 5, seconds: 5 }),
      unavailableAt: now.add({ hours: 6 }),
    })),
    Match.when("available", () => ({
      state: "available" as const,
      code: "24681357",
      unavailableAt: now.add({ hours: 5 }),
    })),
    Match.when("ended", () => ({ state: "ended" as const })),
    Match.when("unavailable", () => ({ state: "unavailable" as const })),
    Match.exhaustive
  );

export default async function ReservationAccessPreviewPage({
  searchParams,
}: ReservationAccessPreviewPageProps) {
  await connection();
  const { state } = Option.getOrElse(
    decodePreviewSearchParams(await searchParams),
    () => ({ state: undefined })
  );

  return runWithRequestLocale((locale) => (
    <ReservationAccessPage
      access={getPreviewAccess(state ?? "available", Temporal.Now.instant())}
      locale={locale}
    />
  ));
}
