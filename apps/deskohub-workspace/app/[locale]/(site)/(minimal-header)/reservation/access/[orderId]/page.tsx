import { Option, Schema } from "effect";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { createNoindexedPageMetadata } from "@/features/public-pages/page-metadata";
import { ReservationAccessRoute } from "@/features/reservation/components/reservation-access-route";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";

export const maxDuration = 30;
export const instant = true;

type LocalizedReservationAccessPageProps = {
  params: Promise<{ orderId: string }>;
};

const decodeReservationAccessParams = Schema.decodeUnknownOption(
  Schema.Struct({ orderId: workspaceReservationIdSchema })
);

export async function generateMetadata({
  params,
}: LocalizedReservationAccessPageProps): Promise<Metadata> {
  if (Option.isNone(decodeReservationAccessParams(await params))) notFound();

  return runWithRequestLocale((locale) => ({
    ...createNoindexedPageMetadata({
      locale,
      title: { absolute: m.reservationAccessMetadataTitle({}, { locale }) },
      description: m.reservationAccessMetadataDescription({}, { locale }),
    }),
    referrer: "no-referrer",
  }));
}

export default function LocalizedReservationAccessPage({
  params,
}: LocalizedReservationAccessPageProps) {
  return <ReservationAccessRoute params={params} />;
}
