import { Suspense } from "react";
import { AdministrationLink as Link } from "@/features/administration/admin-link";
import {
  AdministrationNoticeBanner,
  AdministrationPage,
  AdministrationPageHeader,
  ReservationTable,
} from "@/features/administration/components";
import { AdministrationRouteLoading } from "@/features/administration/loading";
import { loadAdministrationCustomerActivity } from "@/features/administration/page-data.server";
import { requireDotyposCustomerRouteId } from "@/features/administration/route-identifiers.server";
import { CustomerAdministrationDetailPage } from "@/features/discounts/admin/customer-admin-components";
import {
  type DiscountAdminSearchParams,
  loadOptionalDiscountAdminCustomerPageData,
} from "@/features/discounts/admin/page-data.server";

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
  const decodedCustomerId = requireDotyposCustomerRouteId(customerId);
  const [liveData, activity] = await Promise.all([
    loadOptionalDiscountAdminCustomerPageData(decodedCustomerId, searchParams),
    loadAdministrationCustomerActivity(customerId),
  ]);
  const { notice, profile } = liveData;

  if (!profile) {
    return (
      <AdministrationPage>
        <AdministrationPageHeader
          description="Customer and discount details are temporarily unavailable. Associated reservations remain visible."
          eyebrow="Customer"
          title="Customer details unavailable"
        />
        <AdministrationNoticeBanner notice={notice} />
        {activity.reservationHistoryTruncated && (
          <p className="mb-3 text-sm text-navy-blue/65">
            Showing the 24 most recently updated reservations.{" "}
            <Link
              className="font-semibold underline underline-offset-4"
              href={`/admin/reservations?customerId=${encodeURIComponent(customerId)}`}
            >
              View all reservations
            </Link>
          </p>
        )}
        <ReservationTable
          emptyMessage="This customer has no reservations."
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
    />
  );
}
