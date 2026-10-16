import { AdministrationBreadcrumb } from "@/features/administration/breadcrumb.server";

export default async function CustomerBreadcrumb({
  params,
}: {
  readonly params: Promise<{ readonly customerId: string }>;
}) {
  const { customerId } = await params;
  return <AdministrationBreadcrumb segments={["customers", customerId]} />;
}
