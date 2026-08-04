import { AdministrationBreadcrumb } from "@/features/administration/breadcrumb.server";

export default async function CodeBreadcrumb({
  params,
}: {
  readonly params: Promise<{ readonly codeId: string }>;
}) {
  const { codeId } = await params;
  return <AdministrationBreadcrumb segments={["codes", codeId]} />;
}
