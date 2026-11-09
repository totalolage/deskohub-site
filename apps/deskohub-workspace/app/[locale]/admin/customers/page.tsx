import { AdministrationCustomerList } from "@/features/administration/customer-list";
import type { AdministrationSearchParams } from "@/features/administration/page-data.server";

export default function DiscountCustomersAdminPage({
  searchParams,
}: {
  readonly searchParams: AdministrationSearchParams;
}) {
  return <AdministrationCustomerList searchParams={searchParams} />;
}
