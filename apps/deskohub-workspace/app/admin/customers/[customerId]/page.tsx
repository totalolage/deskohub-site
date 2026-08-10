import {
  AdministrationNoticeBanner,
  AdministrationPage,
  AdministrationPageHeader,
  ReservationTable,
} from "@/features/administration/components";
import { loadAdministrationCustomerActivity } from "@/features/administration/page-data.server";
import { CustomerAdministrationDetailPage } from "@/features/discounts/admin/customer-admin-components";
import {
  type DiscountAdminSearchParams,
  loadOptionalDiscountAdminCustomerPageData,
} from "@/features/discounts/admin/page-data.server";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";

export default async function DiscountCustomerAdminDetailPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly customerId: string }>;
  readonly searchParams: DiscountAdminSearchParams;
}) {
  const { customerId } = await params;
  const [liveData, activity] = await Promise.all([
    loadOptionalDiscountAdminCustomerPageData(
      customerId as DotyposCustomerId,
      searchParams
    ),
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
