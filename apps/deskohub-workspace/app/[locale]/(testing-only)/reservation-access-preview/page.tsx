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
    state: Schema.optional(Schema.Literals(["available", "unavailable"])),
  })
);

const getPreviewAccess = Match.type<"available" | "unavailable">().pipe(
  Match.when(
    "available",
    (): ReservationAccessViewModel => ({
      state: "available",
      code: "24681357",
      accessStartsAt: Temporal.Instant.from("2026-08-13T08:00:00Z"),
      accessEndsAt: Temporal.Instant.from("2026-08-13T16:00:00Z"),
    })
  ),
  Match.when(
    "unavailable",
    (): ReservationAccessViewModel => ({ state: "unavailable" })
  ),
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
      access={getPreviewAccess(state ?? "available")}
      locale={locale}
    />
  ));
}
