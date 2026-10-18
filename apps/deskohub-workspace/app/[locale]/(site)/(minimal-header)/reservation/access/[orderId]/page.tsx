import { Option, Schema } from "effect";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getWorkspaceAlternates, m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { ReservationAccessRoute } from "@/features/reservation/components/reservation-access-route";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { reservationAccessPath } from "@/features/reservation/routes";
import { workspaceSiteConstants } from "@/shared/utils";

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
  const decodedParams = decodeReservationAccessParams(await params);
  const { orderId } = Option.getOrElse(decodedParams, () => notFound());

  return runWithRequestLocale((locale) => {
    const title = m.reservationAccessMetadataTitle({}, { locale });
    const description = m.reservationAccessMetadataDescription({}, { locale });
    const alternates = getWorkspaceAlternates(
      locale,
      `${reservationAccessPath}/${orderId}`
    );

    return {
      title,
      description,
      alternates,
      openGraph: {
        title,
        description,
        url: alternates.canonical,
        siteName: workspaceSiteConstants.brand.name,
        locale,
        type: "website",
      },
      robots: { index: false, follow: false },
      referrer: "no-referrer",
    } satisfies Metadata;
  });
}

export default function LocalizedReservationAccessPage({
  params,
}: LocalizedReservationAccessPageProps) {
  return <ReservationAccessRoute params={params} />;
}
