import { redirect } from "next/navigation";

export default async function LegacyNexiOperationPage({
  params,
}: {
  readonly params: Promise<{ readonly operationId: string }>;
}) {
  const { operationId } = await params;
  redirect(`/admin/nexi/operations/${encodeURIComponent(operationId)}`);
}
