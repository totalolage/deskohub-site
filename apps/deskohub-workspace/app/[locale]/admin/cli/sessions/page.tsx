import { CliSessionsScreen } from "@/features/admin-cli/cli-sessions-screen";

export default function CliSessionsPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly result?: string }>;
}) {
  return <CliSessionsScreen searchParams={searchParams} />;
}
