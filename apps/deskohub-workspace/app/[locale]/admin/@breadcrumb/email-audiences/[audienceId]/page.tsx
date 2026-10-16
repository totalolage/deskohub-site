import { AdministrationBreadcrumb } from "@/features/administration/breadcrumb.server";
export default async function EmailAudienceBreadcrumb({
  params,
}: {
  readonly params: Promise<{ readonly audienceId: string }>;
}) {
  const { audienceId } = await params;
  return (
    <AdministrationBreadcrumb segments={["email-audiences", audienceId]} />
  );
}
