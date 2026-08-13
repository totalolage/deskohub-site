import { AdministrationBreadcrumb } from "@/features/administration/breadcrumb.server";

export default function VouchersBreadcrumb() {
  return <AdministrationBreadcrumb segments={["vouchers"]} />;
}
