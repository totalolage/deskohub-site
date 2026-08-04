import {
  AdministrationNoticeBanner,
  AdministrationPage,
  AdministrationPageHeader,
  Pagination,
  ReservationTable,
} from "@/features/administration/components";
import {
  administrationFixturesEnabled,
  loadFixtureCustomerProfile,
} from "@/features/administration/fixtures";
import { loadAdministrationCustomerReservations } from "@/features/administration/page-data.server";
import { CustomerAdministrationDetailPage } from "@/features/discounts/admin/customer-admin-components";
import {
  type DiscountAdminSearchParams,
  loadOptionalDiscountAdminCustomerPageData,
} from "@/features/discounts/admin/page-data.server";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";

export const dynamic = "force-dynamic";

export default async function DiscountCustomerAdminDetailPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly customerId: string }>;
  readonly searchParams: DiscountAdminSearchParams;
}) {
  const { customerId } = await params;
  const reservationsPromise = loadAdministrationCustomerReservations(
    customerId,
    searchParams
  );
  const fixtureProfile = administrationFixturesEnabled()
    ? loadFixtureCustomerProfile(customerId)
    : null;
  const [liveData, reservations] = await Promise.all([
    fixtureProfile
      ? Promise.resolve({ notice: undefined, profile: fixtureProfile })
      : loadOptionalDiscountAdminCustomerPageData(
          customerId as DotyposCustomerId,
          searchParams
        ),
    reservationsPromise,
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
          reservations={reservations.items}
        />
        <Pagination
          basePath={`/admin/customers/${customerId}`}
          page={reservations.page}
          pageCount={reservations.pageCount}
          pageParam="reservationsPage"
        />
      </AdministrationPage>
    );
  }

  return (
    <CustomerAdministrationDetailPage
      notice={notice}
      profile={profile}
      reservations={reservations}
    />
  );
}
