import { AdministrationBreadcrumb } from "@/features/administration/breadcrumb.server";

export default async function CustomerDiscountCodeCreationBreadcrumb({
  params,
}: {
  readonly params: Promise<{ readonly customerId: string }>;
}) {
  const { customerId } = await params;
  return (
    <AdministrationBreadcrumb
      segments={["customers", customerId, "create-code"]}
    />
  );
}
