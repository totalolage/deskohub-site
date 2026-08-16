import { AdministrationBreadcrumb } from "@/features/administration/breadcrumb.server";

export default async function OperationBreadcrumb({
  params,
}: {
  readonly params: Promise<{ readonly operationId: string }>;
}) {
  const { operationId } = await params;
  return (
    <AdministrationBreadcrumb segments={["nexi", "operations", operationId]} />
  );
}
