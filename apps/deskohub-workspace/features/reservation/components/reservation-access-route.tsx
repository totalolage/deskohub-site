import { Effect, Option, Schema } from "effect";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { CheckoutFlowPageSkeleton } from "@/features/checkout/components/checkout-flow-page-skeleton";
import { type Locale, m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { ReservationAccessService } from "@/features/reservation/backend/reservation-access.service";
import { readReservationAccessCookie } from "@/features/reservation/backend/reservation-access-cookie";
import { ReservationAccessPage } from "@/features/reservation/components/reservation-access-page";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { Skeleton } from "@/shared/components/ui/skeleton";

type ReservationAccessPresentation = "page" | "modal";

type ReservationAccessRouteProps = {
  readonly params: Promise<{ orderId: string }>;
  readonly presentation?: ReservationAccessPresentation;
};

const decodeReservationAccessParams = Schema.decodeUnknownOption(
  Schema.Struct({ orderId: workspaceReservationIdSchema })
);

export function ReservationAccessRoute({
  params,
  presentation = "page",
}: ReservationAccessRouteProps) {
  return runWithRequestLocale((locale) => (
    <Suspense
      fallback={
        <ReservationAccessFallback
          locale={locale}
          presentation={presentation}
        />
      }
    >
      <ReservationAccessContent params={params} presentation={presentation} />
    </Suspense>
  ));
}

async function ReservationAccessContent({
  params,
  presentation,
}: {
  readonly params: Promise<{ orderId: string }>;
  readonly presentation: ReservationAccessPresentation;
}) {
  const decodedParams = decodeReservationAccessParams(await params);
  const { orderId } = Option.getOrElse(decodedParams, () => notFound());

  return runWithRequestLocale(async (locale) => {
    await connection();
    const cookieStore = await cookies();
    const accessCookie = readReservationAccessCookie(cookieStore, orderId);
    const access = await Effect.flatMap(ReservationAccessService, (service) =>
      service.getAccess({ orderId, locale, accessCookie })
    ).pipe(
      Effect.provide(ReservationAccessService.Live),
      runWorkspaceEffect("reservation.access.load")
    );

    return (
      <ReservationAccessPage
        access={access}
        locale={locale}
        orderId={orderId}
        presentation={presentation}
      />
    );
  });
}

function ReservationAccessFallback({
  locale,
  presentation,
}: {
  readonly locale: Locale;
  readonly presentation: ReservationAccessPresentation;
}) {
  if (presentation === "page") {
    return (
      <CheckoutFlowPageSkeleton
        label={m.reservationAccessMetadataTitle({}, { locale })}
        locale={locale}
      />
    );
  }

  return (
    <output
      aria-busy="true"
      aria-label={m.reservationAccessMetadataTitle({}, { locale })}
      className="block bg-white p-6 text-navy-blue sm:p-10"
    >
      <div aria-hidden="true" className="flex items-center gap-4 sm:gap-6">
        <Skeleton className="h-13 w-13 shrink-0 rounded-full bg-aquamarine-green/14 ring-8 ring-aquamarine-green/8 sm:h-16 sm:w-16" />
        <div className="min-w-0 flex-1 space-y-5">
          <Skeleton className="h-12 w-full max-w-lg rounded-2xl" />
          <Skeleton className="h-5 w-full max-w-xl rounded-full" />
          <Skeleton className="h-5 w-3/4 rounded-full" />
        </div>
      </div>
    </output>
  );
}
