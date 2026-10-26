import { Suspense } from "react";
import { AdministrationLink as Link } from "@/features/administration/admin-link";
import { administrationHref } from "@/features/administration/administration-href";
import {
  AdministrationNoticeBanner,
  AdministrationPage,
  AdministrationPageHeader,
  ReservationTable,
} from "@/features/administration/components";
import { m } from "@/features/administration/i18n";
import { AdministrationRouteLoading } from "@/features/administration/loading";
import {
  loadAdministrationCustomerActivity,
  loadAdministrationCustomerReservationActivity,
} from "@/features/administration/page-data.server";
import { requireDotyposCustomerRouteId } from "@/features/administration/route-identifiers.server";
import { CustomerAdministrationDetailPage } from "@/features/discounts/admin/customer-admin-components";
import {
  type DiscountAdminSearchParams,
  loadOptionalDiscountAdminCustomerPageData,
} from "@/features/discounts/admin/page-data.server";
import { getRequestLocale } from "@/features/i18n/server/request-locale";

export default function DiscountCustomerAdminDetailPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly customerId: string }>;
  readonly searchParams: DiscountAdminSearchParams;
}) {
  return (
    <Suspense fallback={<AdministrationRouteLoading />}>
      <DiscountCustomerAdminDetail
        params={params}
        searchParams={searchParams}
      />
    </Suspense>
  );
}

export async function DiscountCustomerAdminDetail({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly customerId: string }>;
  readonly searchParams: DiscountAdminSearchParams;
}) {
  const { customerId } = await params;
  const locale = await getRequestLocale();
  const decodedCustomerId = requireDotyposCustomerRouteId(customerId);
  const [liveData, activity, reservationActivity] = await Promise.all([
    loadOptionalDiscountAdminCustomerPageData(decodedCustomerId, searchParams),
    loadAdministrationCustomerActivity(customerId),
    loadAdministrationCustomerReservationActivity(customerId),
  ]);
  const { notice, profile } = liveData;

  if (!profile) {
    return (
      <AdministrationPage>
        <AdministrationPageHeader
          description={m.administrationCustomerDetailUnavailableDescription(
            {},
            { locale }
          )}
          eyebrow={m.administrationCustomerDetailEyebrow({}, { locale })}
          title={m.administrationCustomerDetailUnavailableTitle({}, { locale })}
        />
        <AdministrationNoticeBanner notice={notice} />
        {activity.reservationHistoryTruncated && (
          <p className="mb-3 text-sm text-navy-blue/65">
            {m.administrationCustomerDetailReservationsTruncated(
              {},
              { locale }
            )}{" "}
            <Link
              className="font-semibold underline underline-offset-4"
              href={`${administrationHref(
                "/[locale]/admin/reservations"
              )}?customerId=${encodeURIComponent(customerId)}`}
            >
              {m.administrationCustomerDetailViewAllReservations(
                {},
                { locale }
              )}
            </Link>
          </p>
        )}
        <ReservationTable
          emptyMessage={m.administrationCustomerDetailNoReservations(
            {},
            { locale }
          )}
          reservations={activity.reservations}
        />
      </AdministrationPage>
    );
  }

  return (
    <CustomerAdministrationDetailPage
      notice={notice}
      profile={profile}
      activity={activity}
      locale={locale}
      reservationActivity={reservationActivity}
    />
  );
}
