import { Match, Option, Schema } from "effect";
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
  state: "upcoming" | "available" | "ended" | "unavailable"
): ReservationAccessViewModel =>
  Match.value(state).pipe(
    Match.when("upcoming", () => ({
      state: "upcoming" as const,
      availableAt: Temporal.Instant.from("2026-08-12T09:30:00Z"),
      unavailableAt: Temporal.Instant.from("2026-08-12T14:30:00Z"),
    })),
    Match.when("available", () => ({
      state: "available" as const,
      code: "SYNTHETIC",
      unavailableAt: Temporal.Instant.from("2026-08-12T14:30:00Z"),
    })),
    Match.when("ended", () => ({ state: "ended" as const })),
    Match.when("unavailable", () => ({ state: "unavailable" as const })),
    Match.exhaustive
  );

export default async function ReservationAccessPreviewPage({
  searchParams,
}: ReservationAccessPreviewPageProps) {
  const { state } = Option.getOrElse(
    decodePreviewSearchParams(await searchParams),
    () => ({ state: undefined })
  );

  return runWithRequestLocale((locale) => (
    <ReservationAccessPage
      access={getPreviewAccess(state ?? "available")}
      locale={locale}
    />
  ));
}
