import { AdministrationBreadcrumb } from "@/features/administration/breadcrumb.server";

export default function DiscountsBreadcrumb() {
  return <AdministrationBreadcrumb segments={["discounts"]} />;
}
