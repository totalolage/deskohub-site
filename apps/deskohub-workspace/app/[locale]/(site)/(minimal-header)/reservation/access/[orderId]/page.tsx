import { Option, Schema } from "effect";
import type { Metadata, ResolvingMetadata } from "next";
import { notFound } from "next/navigation";
import { m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { createPublicPageMetadata } from "@/features/public-pages/page-metadata";
import { ReservationAccessRoute } from "@/features/reservation/components/reservation-access-route";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { reservationAccessPath } from "@/features/reservation/routes";

export const maxDuration = 30;
export const instant = true;

type LocalizedReservationAccessPageProps = {
  params: Promise<{ orderId: string }>;
};

const decodeReservationAccessParams = Schema.decodeUnknownOption(
  Schema.Struct({ orderId: workspaceReservationIdSchema })
);

export async function generateMetadata(
  { params }: LocalizedReservationAccessPageProps,
  parent: ResolvingMetadata
): Promise<Metadata> {
  const decodedParams = decodeReservationAccessParams(await params);
  const { orderId } = Option.getOrElse(decodedParams, () => notFound());

  return runWithRequestLocale(async (locale) => ({
    ...(await createPublicPageMetadata(
      {
        locale,
        pathname: `${reservationAccessPath}/${orderId}`,
        title: { absolute: m.reservationAccessMetadataTitle({}, { locale }) },
        description: m.reservationAccessMetadataDescription({}, { locale }),
      },
      parent
    )),
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  }));
}

export default function LocalizedReservationAccessPage({
  params,
}: LocalizedReservationAccessPageProps) {
  return <ReservationAccessRoute params={params} />;
}
